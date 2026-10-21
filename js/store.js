// 数据层：localStorage 单键 JSON + schemaVersion
const KEY = 'icost.state.v1';
const SCHEMA = 1;

// 本地日期 YYYY-MM-DD。
// 千万别换成 new Date().toISOString().slice(0,10) —— 那是 UTC，
// 东八区在 00:00–08:00 之间会拿到昨天，早上记的账日期就会错一天。
export const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
// 金额一律两位小数落地：浮点累加会漂（0.1+0.2 那种），
// 同步合并那边早就 round2 了，这边不 round 就变成两套精度标准
export const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
export const fmtMoney = (n, sign = false) => {
  const v = (Math.abs(+n || 0)).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return (sign && n > 0 ? '+' : n < 0 ? '-' : '') + v;
};
export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
export const pad2 = (s) => String(s).padStart(2, '0');
export const monthOf = (date) => date.slice(0, 7);
export const ymLabel = (ym) => `${ym.slice(0, 4)} 年 ${+ym.slice(5, 7)} 月`;
export const shiftMonth = (ym, delta) => {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`;
};

// 默认支出分类（一级 + 二级）
const EXPENSE = [
  ['餐饮', '🍜', '#ff9f0a', ['早餐', '午餐', '晚餐', '零食饮料', '外卖']],
  ['购物', '🛍️', '#bf5af2', ['日用品', '服饰', '数码', '家居']],
  ['交通', '🚇', '#0a84ff', ['公交地铁', '打车', '加油', '停车']],
  ['日用', '🧻', '#64d2ff', ['纸品洗护', '清洁', '其他日用']],
  ['水果', '🍎', '#ff375f', ['水果', '生鲜']],
  ['娱乐', '🎮', '#5e5ce6', ['电影', '游戏', 'KTV', '旅游']],
  ['通讯', '📞', '#30d158', ['话费', '网费']],
  ['住房', '🏠', '#ac8e68', ['房租', '水电燃气', '物业']],
  ['医疗', '💊', '#ff453a', ['药品', '门诊', '保健']],
  ['学习', '📚', '#ffd60a', ['书籍', '课程', '文具']],
  ['运动', '🏃', '#32d74b', ['健身', '球类', '装备']],
  ['人情', '🎁', '#ff6482', ['红包', '礼物', '请客']],
  ['宠物', '🐱', '#ff9f0a', ['粮食', '医疗', '用品']],
  ['美容', '💄', '#ff375f', ['护肤', '美发', '美甲']],
  ['孩子', '👶', '#64d2ff', ['奶粉', '玩具', '教育']],
  ['其他', '🧾', '#98989f', []],
];
const INCOME = [
  ['工资', '💰', '#30d158', ['基本工资', '加班', '补贴']],
  ['奖金', '🏆', '#ffd60a', ['年终奖', '绩效']],
  ['理财', '📈', '#0a84ff', ['利息', '基金', '股票']],
  ['红包', '🧧', '#ff453a', []],
  ['报销', '🧾', '#ff9f0a', []],
  ['兼职', '💼', '#bf5af2', []],
  ['二手', '🛒', '#64d2ff', ['闲鱼', '转转']],
  ['礼金', '💝', '#ff6482', []],
  ['退款', '↩️', '#98989f', []],
  ['其他', '🪙', '#98989f', []],
];

function defaultState() {
  const mk = (arr, type) => arr.map(([name, icon, color, subs]) => ({
    id: uid(), name, icon, color, type,
    children: subs.map((s) => ({ id: uid(), name: s })),
  }));
  const acc = (name, icon, color, type, balance = 0) => ({ id: uid(), name, icon, color, type, balance, hidden: false, archived: false, includeNet: true });
  return {
    schema: SCHEMA,
    currentBookId: 'b1',
    books: [
      { id: 'b1', name: '默认账本', icon: '📔', archived: false, created: today() },
    ],
    categories: { expense: mk(EXPENSE, 'expense'), income: mk(INCOME, 'income') },
    accounts: [
      acc('现金', '💵', '#30d158', 'cash'),
      acc('支付宝', '🅰️', '#0a84ff', 'online', 0),
      acc('微信', '💬', '#30d158', 'online'),
      acc('银行卡', '💳', '#ff9f0a', 'bank'),
      acc('信用卡', '🪪', '#ff453a', 'credit'),
    ],
    bills: [],
    // 删除墓碑：合并时用来判断某条账单是"被删了"还是"另一端还没同步到"，避免删掉的账单复活
    tombstones: { bills: [] },  // {id, deletedAt}
    budgets: [],            // {id, scope:'total'|'category', period:'week'|'month'|'year', categoryId?, amount}
    savings: [],            // {id, mode, name, target, startDate, note, records:[{date,amount}]}
    templates: [],          // 快捷记账模板
    recurrings: [],         // 周期记账 {id,type,amount,categoryId,accountId,cycle:'day'|'week'|'month',nextDate,note}
    loans: [],              // {id,name,total,months,monthAmount,startDate,paid}
    claims: [],             // 报销 {billId, amount, status:'pending'|'done', doneTime}
    settings: {
      theme: 'dark',
      startPage: 'home',
      hideAmount: false,
      claimEnabled: true,
      weekStart: 1,
      calendarMode: 'month',
      showCircled: true,   // 显示结余结转
      bookTime: false,
      // 云同步（端到端加密 + GitHub Secret Gist）
      // token / 密码只存在本机 localStorage，永不写入 Gist 明文
      sync: { token: '', gistId: '', hasPassword: false, lastSync: 0 },
    },
  };
}

let state = null;
let listeners = new Set();

export function load() {
  if (state) return state;
  try {
    const raw = localStorage.getItem(KEY);
    state = raw ? migrate(JSON.parse(raw)) : defaultState();
  } catch { state = defaultState(); }
  dropCatIndex();
  return state;
}
function migrate(s) {
  if (!s.schema) s.schema = SCHEMA;
  // 增量同步依赖 updatedAt 与墓碑，老数据补齐
  if (!s.tombstones || typeof s.tombstones !== 'object') s.tombstones = {};
  if (!Array.isArray(s.tombstones.bills)) s.tombstones.bills = [];
  (s.bills || []).forEach((b) => { if (!b.updatedAt) b.updatedAt = b.created || Date.now(); });
  // 其它实体补时间戳：缺省一律 0（不能写 now，否则老数据会被误判成"刚刚改过"而覆盖对端）
  ['accounts', 'books', 'budgets', 'savings', 'templates', 'recurrings', 'loans', 'claims']
    .forEach((k) => (s[k] || []).forEach((x) => { if (x && x.updatedAt === undefined) x.updatedAt = x.created || 0; }));
  return s;
}

export function save() {
  scrubState(state);
  dropCatIndex();          // 分类可能刚被改过，索引作废
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
    lastSaveOk = true;
  } catch (e) {
    // 配额满（localStorage 通常 5MB）时写不进去：内存里的 state 已经改了，
    // 但磁盘没落 —— 静默吞掉的话用户刷新就丢数据还毫无察觉，必须喊出来
    lastSaveOk = false;
    console.error('[store] 保存失败', e);
    if (saveErrorHook) { try { saveErrorHook(e); } catch {} }
  }
  listeners.forEach((fn) => fn());
}
// 上一次 save 是否真的落盘了（配额失败时为 false）
export const saveOk = () => lastSaveOk;
let lastSaveOk = true;
let saveErrorHook = null;
export function onSaveError(fn) { saveErrorHook = fn; }
// 输出层安全：所有用户可输入的字符串字段剥离尖括号，阻断存储型 XSS
const scrub = (s) => (typeof s === 'string' ? s.replace(/[<>]/g, '') : s);
function scrubState(s) {
  s.books?.forEach((b) => { b.name = scrub(b.name); });
  s.accounts?.forEach((a) => { a.name = scrub(a.name); });
  ['expense', 'income'].forEach((t) => s.categories?.[t]?.forEach((c) => {
    c.name = scrub(c.name);
    c.children?.forEach((x) => { x.name = scrub(x.name); });
  }));
  s.bills?.forEach((b) => {
    b.note = scrub(b.note);
    if (Array.isArray(b.tags)) b.tags = b.tags.map(scrub);
  });
  s.savings?.forEach((p) => { p.name = scrub(p.name); p.note = scrub(p.note); });
  s.templates?.forEach((t) => { t.note = scrub(t.note); });
  s.recurrings?.forEach((r) => { r.note = scrub(r.note); });
  s.loans?.forEach((l) => { l.name = scrub(l.name); });
  s.budgets?.forEach((b) => { if (typeof b.name === 'string') b.name = scrub(b.name); });
}
export function subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }
export function reset() { state = defaultState(); save(); }

// ---- 查询辅助 ----
export const S = () => state;
export const curBook = () => state.books.find((b) => b.id === state.currentBookId) || state.books[0];
export const cats = (type) => state.categories[type] || [];
// 分类索引：一级 + 二级放一张 Map，查一次 O(1)。
// 原来的写法每次调用都重建 4 个展开数组再 find —— 账单列表渲染时每笔都调一次，
// 几千笔 × 几十个分类就是几十万次操作，还疯狂制造垃圾对象。
// 索引在 save() / load() 时作废，下次查询重建（分类改动频率远低于查询频率）
let catIndex = null;
function dropCatIndex() { catIndex = null; }
function buildCatIndex() {
  const m = new Map();
  ['expense', 'income'].forEach((t) => (state.categories[t] || []).forEach((c) => {
    if (c && c.id) m.set(c.id, c);
    (c.children || []).forEach((x) => { if (x && x.id) m.set(x.id, x); });
  }));
  catIndex = m;
  return m;
}
export const catById = (id) => (catIndex || buildCatIndex()).get(id);
export const accById = (id) => state.accounts.find((a) => a.id === id);
export const bookBills = (bookId = state.currentBookId, ym = null) =>
  state.bills.filter((b) => b.bookId === bookId && (!ym || b.date.startsWith(ym)))
    .sort((a, b) => (b.date + (b.time || '')).localeCompare(a.date + (a.time || '')) || b.created - a.created);

export function monthSum(bookId, ym, type) {
  return state.bills.filter((b) => b.bookId === bookId && b.type === type && b.date.startsWith(ym))
    .reduce((s, b) => s + b.amount, 0);
}
export function netWorth() {
  return state.accounts.filter((a) => !a.hidden && !a.archived && a.includeNet)
    .reduce((s, a) => s + (a.type === 'credit' ? -Math.abs(a.balance) : a.balance), 0);
}
export function accountStat() {
  const list = state.accounts.filter((a) => !a.hidden && !a.archived);
  return {
    net: list.filter((a) => a.includeNet).reduce((s, a) => s + (a.type === 'credit' ? -Math.abs(a.balance) : a.balance), 0),
    asset: list.filter((a) => a.type !== 'credit').reduce((s, a) => s + a.balance, 0),
    debt: list.filter((a) => a.type === 'credit').reduce((s, a) => s + Math.abs(a.balance), 0),
    borrowed: list.reduce((s, a) => s + (a.borrow || 0), 0),
    lent: list.reduce((s, a) => s + (a.lent || 0), 0),
  };
}
// 结余结转：起始月前的净收入累计
export function carryOver(bookId, ym) {
  return state.bills.filter((b) => b.bookId === bookId && b.date < ym + '-01')
    .reduce((s, b) => s + (b.type === 'income' ? b.amount : b.type === 'expense' ? -b.amount : 0), 0);
}

// 账户余额变动的唯一入口：dir=+1 记账，-1 回滚。
// 新增 / 删除 / 编辑三处都走它 —— 之前 record.js 自己写了一份回滚，
// 结果只回滚旧的、没记回新的，编辑账单后余额就错了。
function applyBalance(bill, dir) {
  const acc = accById(bill.accountId);
  if (!acc) return;
  const amt = round2(bill.amount) * dir;
  if (bill.type === 'expense') acc.balance = round2(acc.balance - amt);
  else if (bill.type === 'income') acc.balance = round2(acc.balance + amt);
  else if (bill.type === 'transfer') {
    const to = accById(bill.toAccountId);
    acc.balance = round2(acc.balance - amt);
    if (to) to.balance = round2(to.balance + amt);
  }
}

export function addBill(data) {
  const now = Date.now();
  const bill = {
    id: uid(), bookId: state.currentBookId, created: now, updatedAt: now,
    time: new Date().toTimeString().slice(0, 5),
    images: [], tags: [], ...data,
  };
  state.bills.push(bill);
  applyBalance(bill, 1);
  if (bill.claim === 'pending') state.claims.push({ billId: bill.id, amount: bill.amount, status: 'pending' });
  save();
  return bill;
}
export function deleteBill(id) {
  const i = state.bills.findIndex((b) => b.id === id);
  if (i < 0) return;
  const bill = state.bills[i];
  applyBalance(bill, -1);
  state.claims = state.claims.filter((c) => c.billId !== id);
  state.bills.splice(i, 1);
  // 写墓碑：让另一端合并时知道这是"主动删除"，而不是"还没同步到"
  if (!state.tombstones) state.tombstones = { bills: [] };
  if (!state.tombstones.bills) state.tombstones.bills = [];
  state.tombstones.bills = state.tombstones.bills.filter((t) => t.id !== id);
  state.tombstones.bills.push({ id, deletedAt: Date.now() });
  save();
}
export function updateBill(id, patch) {
  const b = state.bills.find((x) => x.id === id);
  if (b) { Object.assign(b, patch, { updatedAt: Date.now() }); save(); }
  return b;
}
// 编辑账单：金额 / 类型 / 账户都可能变，余额必须「回滚旧的 + 应用新的」。
// 页面层别再自己写加减 —— record.js 之前就是只回滚没应用，编辑后余额等于这笔账没记。
export function updateBillAndBalance(id, patch) {
  const b = state.bills.find((x) => x.id === id);
  if (!b) return null;
  applyBalance(b, -1);
  Object.assign(b, patch, { updatedAt: Date.now() });
  applyBalance(b, 1);
  save();
  return b;
}
// 清理过期墓碑（默认保留 30 天，防止无限增长）
export function pruneTombstones(days = 30) {
  if (!state?.tombstones?.bills) return;
  const cutoff = Date.now() - days * 24 * 3600 * 1000;
  state.tombstones.bills = state.tombstones.bills.filter((t) => t.deletedAt > cutoff);
}
export function billById(id) { return state.bills.find((b) => b.id === id); }

export function addAccount(data) {
  const now = Date.now();
  const a = { id: uid(), hidden: false, archived: false, includeNet: true, balance: 0, created: now, updatedAt: now, ...data };
  state.accounts.push(a); save(); return a;
}
// updatedAt 是跨端合并的依据：改余额/改名都必须打时间戳，否则另一端看不到这次修改
export function updateAccount(id, patch) {
  const a = accById(id);
  if (a) { Object.assign(a, patch, { updatedAt: Date.now() }); save(); }
  return a;
}
