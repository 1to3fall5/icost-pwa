// 删除墓碑与安全出口的回归测试
// 覆盖：
//   1. 任何集合的删除都要落墓碑，并被 hasLocalChanges 认作"本地有改动"
//   2. 合并时墓碑双向生效：本机删的、对端删的，都不会复活
//   3. 墓碑是分桶结构，不会串集合（删了账户不会误删同 id 的账单）
//   4. 账户删除会连带清掉名下账单（否则余额统计指向空账户）
//   5. 接入失败页的文本走 textContent，不进 HTML 解析（存储型 XSS 回归）
import { readFileSync } from 'node:fs';

const mem = new Map();
globalThis.localStorage = {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => mem.set(k, String(v)),
  removeItem: (k) => mem.delete(k),
};

let pass = 0; let fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log('PASS ' + name); }
  else { fail++; console.log('FAIL ' + name + (extra ? '  -> ' + extra : '')); }
};

const store = await import('../js/store.js');
const sync = await import('../js/sync.js');

function fresh() {
  store.reset();
  const st = store.S();
  st.accounts = [
    { id: 'accA', name: '现金', balance: 100, updatedAt: 1000 },
    { id: 'accB', name: '微信', balance: 0, updatedAt: 1000 },
  ];
  st.bills = [
    { id: 'bA', type: 'expense', amount: 30, accountId: 'accA', bookId: 'bk', date: '2026-10-01', updatedAt: 2000 },
  ];
  st.budgets = [{ id: 'bud1', scope: 'total', period: 'month', amount: 3000, updatedAt: 1500 }];
  st.savings = [{ id: 'sv1', name: '旅游', target: 10000, updatedAt: 1500 }];
  st.templates = [{ id: 'tp1', note: '早餐', amount: 12, updatedAt: 1500 }];
  st.recurrings = [{ id: 'rc1', amount: 88, cycle: 'month', updatedAt: 1500 }];
  st.loans = [{ id: 'ln1', name: '车贷', total: 100000, updatedAt: 1500 }];
  st.books = [{ id: 'bk', name: '日常', updatedAt: 1500 }];
  st.currentBookId = 'bk';
  st.settings = { sync: { token: 'tk', gistId: 'g1', baseSyncedAt: 1000 }, theme: 'dark' };
  store.save();
  return st;
}

// ---- 1. 各集合删除都落墓碑 ----
const cases = [
  ['budgets', 'bud1', () => { store.S().budgets.splice(0, 1); store.addTombstone('budgets', 'bud1'); store.save(); }],
  ['savings', 'sv1', () => { store.S().savings = []; store.addTombstone('savings', 'sv1'); store.save(); }],
  ['templates', 'tp1', () => { store.S().templates = []; store.addTombstone('templates', 'tp1'); store.save(); }],
  ['recurrings', 'rc1', () => { store.S().recurrings = []; store.addTombstone('recurrings', 'rc1'); store.save(); }],
  ['loans', 'ln1', () => { store.S().loans = []; store.addTombstone('loans', 'ln1'); store.save(); }],
];
cases.forEach(([kind, id, run]) => {
  fresh();
  run();
  const tombs = store.S().tombstones[kind] || [];
  ok(`${kind} 删除后写入墓碑`, tombs.some((t) => t.id === id), JSON.stringify(tombs));
  ok(`${kind} 删除被认作本地改动`, sync.hasLocalChanges() === true);
});

// ---- 2. 合并：本机删掉的不会被对端复活 ----
fresh();
store.S().budgets = [];
store.addTombstone('budgets', 'bud1');
store.save();
let m = sync.mergeRemote({
  budgets: [{ id: 'bud1', scope: 'total', period: 'month', amount: 3000, updatedAt: 1500 }],
});
ok('本机删除的预算不会被对端复活', !m.budgets.some((b) => b.id === 'bud1'), JSON.stringify(m.budgets));

fresh();
m = sync.mergeRemote({
  savings: [{ id: 'sv1', name: '旅游', target: 10000, updatedAt: 1500 }],
  tombstones: { savings: [{ id: 'sv1', deletedAt: 9000 }] },
});
ok('对端删除的存钱计划本机也剔除', !m.savings.some((s) => s.id === 'sv1'), JSON.stringify(m.savings));

// 删除时间早于最后修改 -> 说明删完又改过，应保留
fresh();
m = sync.mergeRemote({
  templates: [{ id: 'tp1', note: '早餐（改）', amount: 15, updatedAt: 8000 }],
  tombstones: { templates: [{ id: 'tp1', deletedAt: 1500 }] },
});
ok('删除早于最后修改 -> 不删（保留改后的版本）',
  m.templates.some((t) => t.id === 'tp1' && t.note === '早餐（改）'), JSON.stringify(m.templates));

// ---- 3. 墓碑分桶：删账户不影响账单 ----
fresh();
store.deleteAccount('accA');
const st = store.S();
ok('删账户后账户消失', !st.accounts.some((a) => a.id === 'accA'));
ok('删账户连带清掉名下账单', !st.bills.some((b) => b.accountId === 'accA'));
ok('账户墓碑落在 accounts 桶', (st.tombstones.accounts || []).some((t) => t.id === 'accA'));
ok('账单墓碑落在 bills 桶，未污染 accounts 桶',
  !(st.tombstones.accounts || []).some((t) => t.id === 'bA')
  && (st.tombstones.bills || []).some((t) => t.id === 'bA'));

// 同 id 在另一个集合里不应被误删
fresh();
store.S().budgets = [{ id: 'accA', scope: 'total', period: 'month', amount: 100, updatedAt: 1200 }];
store.save();
store.deleteAccount('accA');
ok('删除账户不会误删同 id 的预算', store.S().budgets.some((b) => b.id === 'accA'));

// ---- 4. 墓碑清理会覆盖所有桶 ----
fresh();
store.addTombstone('accounts', 'gone1');
store.S().tombstones.loans.push({ id: 'gone2', deletedAt: 1 });   // 远古墓碑
store.pruneTombstones(30);
ok('过期墓碑被清理（loans 桶）', !store.S().tombstones.loans.some((t) => t.id === 'gone2'));
ok('新墓碑被保留（accounts 桶）', store.S().tombstones.accounts.some((t) => t.id === 'gone1'));
ok('空桶结构仍在（不会被 prune 抹掉）',
  ['bills', 'accounts', 'books', 'budgets', 'savings', 'templates', 'recurrings', 'loans', 'claims']
    .every((k) => Array.isArray(store.S().tombstones[k])));

// ---- 5. 老数据升级：缺的墓碑桶要补齐 ----
mem.set('icost.state.v1', JSON.stringify({
  schema: 1, books: [{ id: 'bk', name: '日常' }], accounts: [], bills: [],
  categories: { expense: [], income: [] }, currentBookId: 'bk',
  settings: {}, tombstones: { bills: [] },
}));
// 重新导入模块以触发 load() 的 migrate
const store2 = await import('../js/store.js?fresh=' + Date.now());
const st2 = store2.load();
ok('老数据升级后 accounts 桶被补齐', Array.isArray(st2.tombstones.accounts));
ok('老数据升级后 savings 桶被补齐', Array.isArray(st2.tombstones.savings));

// ---- 6. claims：主键是 billId，不是 id ----
// 这段以前是坏的：mergeList 按 id 判断，而报销记录只有 billId，
// 结果两条都找不到 id、被整条丢弃 —— 报销在跨端同步里从来没生效过。
// 注意：用例里的报销必须对应真实账单，否则会被"孤儿回收"正确剔除（见下面单独一条）。
fresh();
store.S().claims = [
  { billId: 'bA', amount: 30, status: 'pending' },
  { billId: 'bB', amount: 50, status: 'done' },
];
store.save();
m = sync.mergeRemote({
  bills: [
    { id: 'bA', type: 'expense', amount: 30, accountId: 'accA', bookId: 'bk', updatedAt: 2000 },
    { id: 'bB', type: 'expense', amount: 50, accountId: 'accB', bookId: 'bk', updatedAt: 2000 },
    { id: 'bC', type: 'expense', amount: 70, accountId: 'accA', bookId: 'bk', updatedAt: 2000 },
  ],
  claims: [
    { billId: 'bA', amount: 35, status: 'done', updatedAt: 5000 },   // 对端改过，更新
    { billId: 'bC', amount: 70, status: 'pending' },
  ],
});
ok('claims 按 billId 合并（不再被整条丢弃）', m.claims.length === 3, JSON.stringify(m.claims));
ok('claims 取较新的一条（bA 状态改为 done）',
  m.claims.some((c) => c.billId === 'bA' && c.status === 'done'), JSON.stringify(m.claims));
ok('只在本机存在的报销被保留（bB）', m.claims.some((c) => c.billId === 'bB'));

// 孤儿回收：指向已不存在账单的报销必须清掉
fresh();
store.S().claims = [{ billId: 'bGone', amount: 99, status: 'pending' }];
store.save();
m = sync.mergeRemote({ bills: [] });
ok('指向已删账单的报销被回收', !m.claims.some((c) => c.billId === 'bGone'), JSON.stringify(m.claims));

// 账单删除时报销也落墓碑，且以 billId 为键
fresh();
store.S().claims = [{ billId: 'bA', amount: 30, status: 'pending' }];
store.save();
store.deleteBill('bA');
ok('删账单时报销记录被清掉', !store.S().claims.some((c) => c.billId === 'bA'));
ok('报销墓碑以 billId 为键写入 claims 桶',
  (store.S().tombstones.claims || []).some((t) => t.id === 'bA'),
  JSON.stringify(store.S().tombstones.claims));

// 撤销报销同样要落墓碑，否则换个设备又变回"待报销"
fresh();
store.S().claims = [{ billId: 'bA', amount: 30, status: 'pending' }];
store.save();
store.clearClaim('bA');
ok('clearClaim 清掉报销', !store.S().claims.some((c) => c.billId === 'bA'));
ok('clearClaim 写入 claims 墓碑', (store.S().tombstones.claims || []).some((t) => t.id === 'bA'));
ok('本机撤销报销被认作本地改动', sync.hasLocalChanges() === true);

// 对端撤销的报销，本机不能再拉回来
// 前提：账单仍然存在（账单也删了的话，孤儿回收会先把报销清掉，测不出墓碑）
fresh();
store.S().claims = [{ billId: 'bA', amount: 30, status: 'pending' }];
store.save();
m = sync.mergeRemote({
  bills: [{ id: 'bA', type: 'expense', amount: 30, accountId: 'accA', bookId: 'bk', updatedAt: 2000 }],
  // 远端这条报销最后修改于 3000，墓碑删除于 9000 -> 删除更晚，应被剔除
  claims: [{ billId: 'bA', amount: 30, status: 'pending', updatedAt: 3000 }],
  tombstones: { claims: [{ id: 'bA', deletedAt: 9000 }] },
});
ok('对端撤销的报销不会被复活', !m.claims.some((c) => c.billId === 'bA'), JSON.stringify(m.claims));

// 墓碑时间早于记录修改时间 -> 说明撤销后又重新标记过，应保留
fresh();
store.S().claims = [{ billId: 'bA', amount: 30, status: 'pending' }];
store.save();
m = sync.mergeRemote({
  bills: [{ id: 'bA', type: 'expense', amount: 30, accountId: 'accA', bookId: 'bk', updatedAt: 8000 }],
  claims: [{ billId: 'bA', amount: 30, status: 'pending', updatedAt: 8000 }],
  tombstones: { claims: [{ id: 'bA', deletedAt: 1000 }] },
});
ok('撤销后重新标记的报销被保留', m.claims.some((c) => c.billId === 'bA'), JSON.stringify(m.claims));

// ---- 7. XSS 回归：接入失败页不得把错误文本拼进 HTML ----
const src = readFileSync(new URL('../js/pages/syncjoin.js', import.meta.url), 'utf8');
const failBody = src.slice(src.indexOf('const fail = (text)'), src.indexOf('// 1) 解析链接里的配置'));
ok('fail() 不再用 ${text} 直接插值进 innerHTML', !failBody.includes('${text}'));
ok('fail() 用 textContent 写入错误文本', failBody.includes('textContent'));

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exitCode = 1;
