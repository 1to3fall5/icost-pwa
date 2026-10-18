// 端到端验证云同步：加密 → 建 Secret Gist → 读回 → 解密 → 比对 → 清理
// 用法：GH_TOKEN=<github token> node scripts/sync-e2e.mjs
const token = process.env.GH_TOKEN || process.argv[2];
const log0 = (s) => process.stderr.write(s + '\n');
if (!token) { log0('缺少 GH_TOKEN（用法：GH_TOKEN=xxx node scripts/sync-e2e.mjs）'); process.exit(1); }
log0('· 已拿到 token（长度 ' + token.length + '），开始端到端验证');

process.on('uncaughtException', (e) => { log0('UNCAUGHT: ' + e.message + '\n' + String(e.stack).split('\n').slice(0, 6).join('\n')); process.exit(1); });
process.on('unhandledRejection', (e) => { log0('UNHANDLED: ' + (e && e.message ? e.message : String(e))); process.exit(1); });
process.on('exit', (c) => log0('· 进程退出，code=' + c));

// 最小浏览器环境 stub（store.js 需要 localStorage）
globalThis.localStorage = {
  _d: {},
  getItem(k) { return this._d[k] ?? null; },
  setItem(k, v) { this._d[k] = String(v); },
  removeItem(k) { delete this._d[k]; },
};

const { load, S, save } = await import('../js/store.js');
const sync = await import('../js/sync.js');

const PW = 'e2e-测试密码-1234';
let gistId = null;
let failed = false;
// 用 stderr 同步写，避免管道/重定向下 stdout 缓冲被截断
const log = (s) => process.stderr.write(s + '\n');
const check = (ok, msg) => { log((ok ? '✅ ' : '❌ ') + msg); if (!ok) failed = true; };

try {
  load();
  const st = S();
  st.bills.push({
    id: 'e2e-test-bill',
    type: 'expense',
    amount: 12.34,
    categoryId: st.categories.expense[0].id,
    accountId: st.accounts[0].id,
    date: '2026-10-18',
    note: '端到端同步测试',
  });
  save();
  const before = st.bills.length;

  sync.setSync({ token });
  sync.setPassword(PW);

  // 1. 上传
  const push = await sync.pushSync();
  gistId = push.gistId;
  check(!!gistId, `上传成功，创建 Secret Gist ${gistId}，密文 ${Math.round(push.size / 1024)}KB`);

  // 2. 云端确实是密文（不含任何明文账单字段）
  const raw = await fetch(`https://api.github.com/gists/${gistId}`, {
    headers: { Authorization: 'Bearer ' + token, Accept: 'application/vnd.github+json' },
  }).then((r) => r.json());
  const cloud = raw.files['icost-sync.json'].content;
  check(!cloud.includes('端到端同步测试') && !cloud.includes('bills'),
    '云端内容为密文（检索不到「端到端同步测试」与 bills 字段）');
  check(raw.public === false, 'Gist 为 secret（public=false）');

  // 3. 正确密码能解密且往返一致
  const pull = await sync.pullSync();
  check(pull.bills === before, `拉取成功，账单数 ${pull.bills} 与本机 ${before} 一致`);
  check(pull.state.bills.some((b) => b.note === '端到端同步测试'), '备注字段往返无损');

  // 4. 错误密码必须失败
  sync.setPassword('wrong-password');
  let rejected = false;
  try { await sync.pullSync(); } catch (e) { rejected = /解密失败/.test(e.message); }
  check(rejected, '错误密码被拒绝（解密失败）');

  // 5. 无密码时拒绝上传
  sync.setPassword('');
  let blocked = false;
  try { await sync.pushSync(); } catch { blocked = true; }
  check(blocked, '未设密码时拒绝上传');
} catch (e) {
  log('❌ 未通过：' + (e && e.message ? e.message : String(e)));
  log(e && e.stack ? e.stack.split('\n').slice(0, 4).join('\n') : '');
  failed = true;
} finally {
  if (gistId) {
    try {
      const del = await fetch(`https://api.github.com/gists/${gistId}`, {
        method: 'DELETE',
        headers: { Authorization: 'Bearer ' + token, Accept: 'application/vnd.github+json' },
      });
      log(del.ok ? '🧹 已删除测试 Gist' : '⚠️ 测试 Gist 删除失败：HTTP ' + del.status);
    } catch (e) { log('⚠️ 清理异常：' + e.message + '（请手动删除 Gist ' + gistId + '）'); }
  }
}

// 用 exitCode 而不是 process.exit —— 后者会截断管道下尚未 flush 的 stdout
process.exitCode = failed ? 1 : 0;
