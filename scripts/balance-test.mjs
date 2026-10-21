// 账户余额 + 日期时区 回归测试
//
// 这两个都是真踩过的坑：
//  1. 编辑账单只回滚旧金额、没应用新金额 —— 余额等于"这笔账没记过"（record.js 曾手写回滚）
//  2. new Date().toISOString().slice(0,10) 取的是 UTC 日期 —— 东八区早上 8 点前会记成昨天
const mem = new Map();
globalThis.localStorage = {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => mem.set(k, String(v)),
  removeItem: (k) => mem.delete(k),
};

const store = await import('../js/store.js');

let pass = 0; let fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log('OK   ' + name); }
  else { fail++; console.log('FAIL ' + name + (extra ? ' — ' + extra : '')); }
};

const st = store.load();
const S = store.S();
const [acc, acc2] = st.accounts;
acc.balance = 1000; acc2.balance = 500;

// ---------- 1. 新增 / 编辑 / 删除的余额语义 ----------
const b = store.addBill({ type: 'expense', amount: 100, accountId: acc.id, date: '2026-01-10' });
ok('记一笔支出后余额减少', acc.balance === 900, `实际 ${acc.balance}`);

store.updateBillAndBalance(b.id, { amount: 200 });
ok('编辑改金额后余额正确（旧 100 → 新 200）', acc.balance === 800, `实际 ${acc.balance}`);

store.updateBillAndBalance(b.id, { accountId: acc2.id });
ok('改账户后旧账户回滚', acc.balance === 1000, `实际 ${acc.balance}`);
ok('改账户后新账户扣款', acc2.balance === 300, `实际 ${acc2.balance}`);

store.updateBillAndBalance(b.id, { type: 'income' });
ok('改类型（支出→收入）后余额正确', acc2.balance === 700, `实际 ${acc2.balance}`);

store.deleteBill(b.id);
ok('删除后余额回滚', acc2.balance === 500, `实际 ${acc2.balance}`);

// ---------- 2. 转账 ----------
const t = store.addBill({ type: 'transfer', amount: 300, accountId: acc.id, toAccountId: acc2.id, date: '2026-01-10' });
ok('转账：转出账户减少', acc.balance === 700, `实际 ${acc.balance}`);
ok('转账：转入账户增加', acc2.balance === 800, `实际 ${acc2.balance}`);
store.updateBillAndBalance(t.id, { amount: 100 });
ok('编辑转账金额后两端都正确', acc.balance === 900 && acc2.balance === 600, `${acc.balance} / ${acc2.balance}`);
store.deleteBill(t.id);

// ---------- 3. 金额精度 ----------
acc.balance = 0;
store.addBill({ type: 'expense', amount: 0.1, accountId: acc.id, date: '2026-01-10' });
store.addBill({ type: 'expense', amount: 0.2, accountId: acc.id, date: '2026-01-10' });
ok('浮点累加不漂（0.1 + 0.2）', acc.balance === -0.3, `实际 ${acc.balance}`);

// ---------- 4. 分类索引 ----------
const c0 = S.categories.expense[0];
ok('catById 能查一级分类', store.catById(c0.id)?.name === c0.name);
ok('catById 能查二级分类', store.catById(c0.children[0].id)?.name === c0.children[0].name);
S.categories.expense.push({ id: 'newcat', name: '新分类', icon: 'x', color: '#fff', type: 'expense', children: [] });
store.save();                       // save 应让索引作废
ok('新增分类后立刻能查到（索引已失效重建）', store.catById('newcat')?.name === '新分类');

// ---------- 5. 存储配额失败不能静默 ----------
const realSet = globalThis.localStorage.setItem;
globalThis.localStorage.setItem = () => {
  const e = new Error('exceeded the quota');
  e.name = 'QuotaExceededError';
  throw e;
};
let hookCalled = false;
store.onSaveError(() => { hookCalled = true; });
let threw = false;
try { store.save(); } catch { threw = true; }
globalThis.localStorage.setItem = realSet;
ok('配额失败时不抛出（不打断记账流程）', !threw);
ok('配额失败时回调被触发（用户能看到提示）', hookCalled);
ok('配额失败时 saveOk() 为 false', store.saveOk() === false);
store.save();
ok('恢复后 saveOk() 为 true', store.saveOk() === true);

// ---------- 6. today() 必须是本地日期，不是 UTC ----------
process.env.TZ = process.env.TZ || 'Asia/Shanghai';
const RealDate = Date;
// 北京时间 2026-01-15 07:30 —— 对应 UTC 2026-01-14 23:30，正是会被坑的时段
const FIXED = new RealDate('2026-01-15T07:30:00+08:00').getTime();
globalThis.Date = class extends RealDate {
  constructor(...args) { super(...(args.length ? args : [FIXED])); }
  static now() { return FIXED; }
};
const pad = (n) => String(n).padStart(2, '0');
const d = new RealDate(FIXED);
const localStr = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const utcStr = new RealDate(FIXED).toISOString().slice(0, 10);
ok('today() 返回本地日期', store.today() === localStr, `得到 ${store.today()}，本地应为 ${localStr}`);
if (localStr !== utcStr) {
  ok('today() 没被 UTC 坑（不等于 toISOString 结果）', store.today() !== utcStr, `UTC 是 ${utcStr}`);
} else {
  console.log('SKIP 当前时区下本地日期与 UTC 相同，无法区分（建议 TZ=Asia/Shanghai 跑）');
}
globalThis.Date = RealDate;

console.log(`\n通过 ${pass} / 失败 ${fail}`);
process.exit(fail ? 1 : 0);
