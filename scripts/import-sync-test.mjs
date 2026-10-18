// 验证用户关心的链路：电脑上导入账单 → 自动上传 → 手机打开 App 自动拉下来
// 手机端用「清空本机账单 + 重载模块」模拟（云端是共享的，能真实反映另一台设备的拉取行为）
import { writeSync } from 'node:fs';

const mem = new Map();
globalThis.localStorage = {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => mem.set(k, String(v)),
  removeItem: (k) => mem.delete(k),
};

const cloud = { content: null, updatedAt: new Date().toISOString() };
let calls = [];
globalThis.fetch = async (url, opts = {}) => {
  const method = opts.method || 'GET';
  calls.push(method);
  if (method === 'PATCH') {
    cloud.content = JSON.parse(opts.body).files['icost-sync.json'].content;
    cloud.updatedAt = new Date().toISOString();
    return { ok: true, status: 200, json: async () => ({ id: 'g1' }) };
  }
  return {
    ok: true, status: 200,
    json: async () => ({ files: { 'icost-sync.json': { content: cloud.content } }, updated_at: cloud.updatedAt }),
  };
};

const store = await import('../js/store.js');
const sync = await import('../js/sync.js');
store.load();

let pass = 0; let fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; writeSync(1, 'PASS ' + name + '\n'); }
  else { fail++; writeSync(1, 'FAIL ' + name + (extra ? '  -> ' + extra : '') + '\n'); }
};

const PW = 'pw-1234';

// ---------- 电脑端：已配好同步，并记住密码 ----------
function seedPC() {
  const st = store.load();
  st.accounts = [{ id: 'A', name: '微信', balance: 0, updatedAt: 1 }];
  st.bills = [];
  st.tombstones = { bills: [] };
  st.books = [{ id: 'bk', name: '默认账本' }];
  st.currentBookId = 'bk';
  st.settings = { sync: { token: 'tk', gistId: 'g1', auto: true, baseSyncedAt: 0 } };
  store.save();
}
seedPC();
sync.setPassword(PW);
sync.rememberPassword(true);
await sync.pushPayload();                 // 先同步一次，建立云端基线
const baseBills = store.S().bills.length;

// ---------- 模拟导入 403 笔微信账单（带 importKey） ----------
const st = store.S();
const now = Date.now();
for (let i = 0; i < 403; i++) {
  st.bills.push({
    id: 'imp' + i, bookId: 'bk', created: now + i, updatedAt: now + i,
    type: 'expense', amount: 10 + i, date: '2026-09-01', time: '12:00',
    note: '导入的账 ' + i, categoryId: null, accountId: 'A',
    images: [], tags: [], importKey: 'wechat:ORDER' + i,
  });
}
store.save();                              // 导入页就是这一步 —— 会触发自动上传排程
ok('导入后本机有 403 笔', store.S().bills.length === 403, String(store.S().bills.length));

// 自动上传（实际是 4 秒 debounce，这里用 force 立即执行等价）
calls = [];
await sync.runAutoSync({ force: true });
ok('导入后自动触发了上传', calls.includes('PATCH'), calls.join(','));

// 解密云端，确认导入的账单真的上去了
async function peek() {
  const p = JSON.parse(cloud.content);
  const u = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(PW), 'PBKDF2', false, ['deriveKey']);
  const key = await crypto.subtle.deriveKey({ name: 'PBKDF2', salt: u(p.salt), iterations: p.iter, hash: 'SHA-256' },
    base, { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: u(p.iv) }, key, u(p.ct));
  return JSON.parse(new TextDecoder().decode(plain));
}
const up = await peek();
ok('云端收到了全部 403 笔', up.state.bills.length === 403, String(up.state.bills.length));
ok('云端账单带 importKey（可去重）', up.state.bills.every((b) => !!b.importKey));
ok('云端不含 token', up.state.settings.sync.token === undefined);

// ---------- 手机端：换一台设备，打开 App ----------
// 清空本机账单 + 重载 sync 模块（内存密码清空，靠"记住密码"恢复）—— 等价于手机首次/重新打开
store.S().bills = [];
store.S().tombstones = { bills: [] };
store.S().settings.sync.baseSyncedAt = 0;
store.save();
const syncPhone = await import('../js/sync.js?phone=1');
ok('手机端内存中暂无密码', syncPhone.hasPassword() === false);
ok('记住的密码能自动恢复', syncPhone.restorePassword() === true);
ok('自动同步判定为可用', syncPhone.autoEnabled() === true);

calls = [];
await syncPhone.runAutoSync({ force: true });
ok('打开 App 时自动发起了拉取', calls[0] === 'GET', calls.join(','));
ok('手机端拉到了 403 笔', store.S().bills.length === 403, String(store.S().bills.length));
ok('拉取后 importKey 仍在（不会重复）', store.S().bills.every((b) => !!b.importKey));

// ---------- 再同步一次，不应重复 ----------
const before = store.S().bills.length;
await syncPhone.runAutoSync({ force: true });
ok('再次同步不会变多', store.S().bills.length === before, `${before} -> ${store.S().bills.length}`);

// ---------- 手机端自己的账不会被冲掉 ----------
store.S().bills.push({
  id: 'phone1', bookId: 'bk', created: Date.now(), updatedAt: Date.now(),
  type: 'expense', amount: 88, date: '2026-10-01', accountId: 'A', note: '手机上记的',
});
store.save();
await syncPhone.runAutoSync({ force: true });
ok('手机新增的账能上传', store.S().bills.length === before + 1, String(store.S().bills.length));
const up2 = await peek();
ok('云端同时有导入的和手机记的', up2.state.bills.length === 404
  && up2.state.bills.some((b) => b.note === '手机上记的'), String(up2.state.bills.length));

writeSync(1, `\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
