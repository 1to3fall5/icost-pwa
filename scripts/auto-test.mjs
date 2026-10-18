// 自动同步仿真测试：mock GitHub API + 真实加解密
// 重点验证：① 不会自激循环（同步内部的 save 不能再触发同步）② 节流生效 ③ 上传脱敏 ④ 记住密码可恢复
import { writeSync } from 'node:fs';

const mem = new Map();
globalThis.localStorage = {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => mem.set(k, String(v)),
  removeItem: (k) => mem.delete(k),
};

// ---- mock 云端 ----
const cloud = { content: null, updatedAt: new Date().toISOString(), syncedAtStore: 0 };
let calls = [];
globalThis.fetch = async (url, opts = {}) => {
  const method = opts.method || 'GET';
  calls.push(method);
  if (method === 'PATCH') {
    // cloud.deleted 模拟"用户在 GitHub 上把 Gist 删了"
    if (cloud.deleted) return { ok: false, status: 404, json: async () => ({ message: 'Not Found' }) };
    const body = JSON.parse(opts.body);
    cloud.content = body.files['icost-sync.json'].content;
    cloud.updatedAt = new Date().toISOString();
    return { ok: true, status: 200, json: async () => ({ id: 'g1' }) };
  }
  if (method === 'POST') {
    const body = JSON.parse(opts.body);
    cloud.content = body.files['icost-sync.json'].content;
    cloud.deleted = false;
    return { ok: true, status: 201, json: async () => ({ id: 'g2' }) };   // 新地址
  }
  return {
    ok: true, status: 200,
    json: async () => ({
      files: { 'icost-sync.json': { content: cloud.content } },
      updated_at: cloud.updatedAt,
    }),
  };
};

const store = await import('../js/store.js');
const sync = await import('../js/sync.js');

let pass = 0; let fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; writeSync(1, 'PASS ' + name + '\n'); }
  else { fail++; writeSync(1, 'FAIL ' + name + (extra ? '  -> ' + extra : '') + '\n'); }
};

// 独立实现一份解密，用来检查云端密文里到底装了什么
async function decrypt(text, pw) {
  const p = JSON.parse(text);
  const u = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(pw), 'PBKDF2', false, ['deriveKey']);
  const key = await crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: u(p.salt), iterations: p.iter, hash: 'SHA-256' },
    base, { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: u(p.iv) }, key, u(p.ct));
  return JSON.parse(new TextDecoder().decode(plain));
}

const PW = 'test-pw-1234';

function seed() {
  const st = store.load();
  st.accounts = [{ id: 'A', name: '现金', balance: 100, updatedAt: 1 }];
  st.bills = [
    { id: 'b1', type: 'expense', amount: 10, accountId: 'A', bookId: 'bk', date: '2026-10-01', created: 1, updatedAt: 1 },
  ];
  st.tombstones = { bills: [] };
  st.books = [{ id: 'bk', name: '日常' }];
  st.currentBookId = 'bk';
  st.settings = { sync: { token: 'ghp_SECRET', gistId: 'g1', auto: true, baseSyncedAt: 0 }, theme: 'dark' };
  store.save();
  return st;
}

// ---- 1. 首次上传：云端必须不含 token ----
seed();
sync.setPassword(PW);
await sync.pushPayload();
const cloudState = (await decrypt(cloud.content, PW)).state;
ok('云端 payload 不含 token', cloudState.settings.sync.token === undefined,
  JSON.stringify(cloudState.settings.sync));
ok('云端 payload 仍带账单', cloudState.bills.length === 1);
ok('云端 payload 带 deviceId', typeof cloudState.settings.sync.deviceId === 'string');

// ---- 2. 改一笔账后自动同步：应该是「拉 1 次 + 推 1 次」 ----
const st = store.S();
st.bills.push({ id: 'b2', type: 'expense', amount: 25, accountId: 'A', bookId: 'bk', date: '2026-10-02', created: Date.now(), updatedAt: Date.now() });
store.save();

calls = [];
await sync.runAutoSync();
ok('自动同步只打 2 次 API（拉+推）', calls.length === 2, calls.join(','));
ok('先拉后推', calls[0] === 'GET' && calls[1] === 'PATCH', calls.join(','));

const after = (await decrypt(cloud.content, PW)).state;
ok('新账单已上云', after.bills.some((b) => b.id === 'b2'));

// ---- 3. 节流：立刻再跑不应再打 API ----
calls = [];
await sync.runAutoSync();
ok('节流生效，间隔内不再打 API', calls.length === 0, calls.join(','));

// ---- 4. 不会自激：同步内部的 save 不再排新的同步 ----
// 模拟 app.js 的接线，统计 save 被触发了多少次
let saveFired = 0;
store.subscribe(() => { saveFired++; sync.scheduleAutoPush(); });
calls = [];
const before4 = saveFired;
await sync.runAutoSync({ force: true });
ok('force 能跳过节流真正执行', calls.length >= 1, calls.join(','));
ok('同步过程中没有额外的 save 风暴', saveFired - before4 <= 3, `save 触发 ${saveFired - before4} 次`);

// ---- 5. 对端先改：自动同步应合并而不是覆盖 ----
seed();
sync.setPassword(PW);
await sync.pushPayload();                       // 本机基线
const remoteOnly = {
  v: 2,
  state: {
    ...store.S(),
    bills: [
      store.S().bills[0],
      { id: 'bX', type: 'income', amount: 500, accountId: 'A', bookId: 'bk', date: '2026-10-05', created: 9, updatedAt: Date.now() },
    ],
    settings: { sync: {} },
  },
  syncedAt: Date.now() + 60000,
  deviceId: 'other',
};
cloud.content = JSON.stringify({
  v: 1, enc: 'aes-gcm', iter: 150000,
  salt: '', iv: '', ct: '',
}); // 占位，下面用真实加密覆盖
{
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(PW), 'PBKDF2', false, ['deriveKey']);
  const key = await crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: 150000, hash: 'SHA-256' },
    base, { name: 'AES-GCM', length: 256 }, false, ['encrypt']);
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(JSON.stringify(remoteOnly)));
  cloud.content = JSON.stringify({ v: 1, enc: 'aes-gcm', iter: 150000, salt: b64(salt), iv: b64(iv), ct: b64(ct) });
}
store.S().settings.sync.baseSyncedAt = 1;       // 假装本机很久没同步
const beforeCount = store.S().bills.length;
calls = [];
await sync.runAutoSync({ force: true });
ok('对端更新时确实发起了拉取', calls[0] === 'GET', calls.join(','));
ok('对端新账单被合并进来', store.S().bills.some((b) => b.id === 'bX'),
  JSON.stringify(store.S().bills.map((b) => b.id)));
ok('本机原有账单没被冲掉', store.S().bills.length >= beforeCount);

// ---- 6. 记住密码：跨"会话"可恢复 ----
// 用 ?reload 重新加载模块来真实模拟"刷新页面"：内存密码清空，localStorage 还在
sync.setPassword(PW);
sync.rememberPassword(true);
const sync2 = await import('../js/sync.js?reload=1');
ok('刷新后内存中无密码', sync2.hasPassword() === false);
ok('从本机存储恢复密码', sync2.restorePassword() === true && sync2.hasPassword() === true);
sync2.rememberPassword(false);
const sync3 = await import('../js/sync.js?reload=2');
ok('忘记密码后恢复不了', sync3.restorePassword() === false);

// ---- 7. 自动同步开关：关掉后不动作 ----
seed();
sync.setPassword(PW);
sync.setAuto(false);
calls = [];
await sync.runAutoSync({ force: true });
ok('开关关闭时不打 API', calls.length === 0, calls.join(','));
ok('autoEnabled 判定为假', sync.autoEnabled() === false);
sync.setAuto(true);
ok('重新打开后 autoEnabled 为真', sync.autoEnabled() === true);

// ---- 8. 云端 Gist 被删：手动可重建，自动同步绝不偷偷重建 ----
seed();
sync.setPassword(PW);
cloud.deleted = true;
let threw = false;
try { await sync.pushPayload(); } catch { threw = true; }
ok('自动同步遇 404 直接报错，不偷偷重建', threw);

cloud.deleted = true;
let r1 = null;
try { r1 = await sync.pushPayload({ onMissing: async () => false }); } catch { /* 拒绝重建 */ }
ok('用户拒绝重建则不重建', r1 === null);

cloud.deleted = true;
const r2 = await sync.pushPayload({ onMissing: async () => true });
ok('用户同意则重建成功', !!r2 && r2.recreated === true, JSON.stringify(r2));
ok('重建后本机记住了新地址', store.S().settings.sync.gistId === 'g2',
  store.S().settings.sync.gistId);
ok('重建后云端又有数据了', cloud.deleted === false);
cloud.deleted = false;

writeSync(1, `\n${pass} passed, ${fail} failed\n`);
// 内部可能留了节流定时器，显式退出
process.exit(fail ? 1 : 0);
