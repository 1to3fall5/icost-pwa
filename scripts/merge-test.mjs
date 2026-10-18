// 合并逻辑单元测试：不联网，只验证 mergeRemote 的语义
// 覆盖：并集、同 id 取新、墓碑防复活、账户余额重算、设置保留本机
const mem = new Map();
globalThis.localStorage = {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => mem.set(k, String(v)),
  removeItem: (k) => mem.delete(k),
};

const store = await import('../js/store.js');
const sync = await import('../js/sync.js');

let pass = 0; let fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log('PASS ' + name); }
  else { fail++; console.log('FAIL ' + name + (extra ? '  -> ' + extra : '')); }
};
const eq = (name, a, b) => ok(name, JSON.stringify(a) === JSON.stringify(b), `got=${JSON.stringify(a)} want=${JSON.stringify(b)}`);

// 构造本机状态：账户 A 基础余额 100，一笔本地支出 30（余额已扣到 70）
function seed() {
  const st = store.load();
  st.accounts = [{ id: 'A', name: '现金', balance: 70, updatedAt: 1000 }];
  st.bills = [
    { id: 'b1', type: 'expense', amount: 30, accountId: 'A', bookId: 'bk', date: '2026-10-01', updatedAt: 2000 },
    { id: 'b2', type: 'expense', amount: 20, accountId: 'A', bookId: 'bk', date: '2026-10-02', updatedAt: 2000 },
  ];
  st.tombstones = { bills: [] };
  st.settings = { sync: { token: 'tk', gistId: 'g1', baseSyncedAt: 1500 }, theme: 'dark' };
  st.currentBookId = 'bk';
  st.books = [{ id: 'bk', name: '日常' }];
  store.save();
  return st;
}

// ---- 1. 并集 + 同 id 取新 ----
seed();
let m = sync.mergeRemote({
  bills: [
    { id: 'b1', type: 'expense', amount: 99, accountId: 'A', bookId: 'bk', date: '2026-10-01', updatedAt: 5000 }, // 远端更新 -> 赢
    { id: 'b3', type: 'income', amount: 50, accountId: 'A', bookId: 'bk', date: '2026-10-03', updatedAt: 3000 },  // 远端新增 -> 进来
  ],
  accounts: [{ id: 'A', name: '现金', balance: 0, updatedAt: 500 }],
});
eq('并集后账单条数', m.bills.length, 3);
eq('同 id 取新（b1 用远端 99）', m.bills.find((b) => b.id === 'b1').amount, 99);
ok('本地独有账单保留（b2）', m.bills.some((b) => b.id === 'b2'));
ok('远端新增账单进来（b3）', m.bills.some((b) => b.id === 'b3'));

// 余额：账户对象本地新（updatedAt 1000 > 500）-> base = 本地贡献 -(30+20) = -50
// 账户余额 70 - (-50) + 合并贡献(-99 -20 +50 = -69) = 70 + 50 - 69 = 51
eq('余额按本地侧重算', m.accounts[0].balance, 51);

// ---- 2. 墓碑防复活 ----
seed();
m = sync.mergeRemote({
  bills: [
    { id: 'b2', type: 'expense', amount: 20, accountId: 'A', bookId: 'bk', date: '2026-10-02', updatedAt: 2000 }, // 对端还留着这笔
  ],
  tombstones: { bills: [] },
});
// 本机墓碑：b2 已在 9000 被删
store.S().tombstones.bills = [{ id: 'b2', deletedAt: 9000 }];
m = sync.mergeRemote({ bills: [{ id: 'b2', type: 'expense', amount: 20, accountId: 'A', updatedAt: 2000 }] });
ok('已删账单不会被对端复活', !m.bills.some((b) => b.id === 'b2'), JSON.stringify(m.bills.map((b) => b.id)));

// 反向：对端墓碑里的删除，本机也不能留
seed();
store.S().tombstones.bills = [];
m = sync.mergeRemote({
  bills: [{ id: 'b1', type: 'expense', amount: 30, accountId: 'A', updatedAt: 2000 }],
  tombstones: { bills: [{ id: 'b1', deletedAt: 8000 }] },
});
ok('对端删除的账单本机也剔除', !m.bills.some((b) => b.id === 'b1'));

// 删除后又改过（updatedAt > deletedAt）则保留
seed();
store.S().tombstones.bills = [];
m = sync.mergeRemote({
  bills: [{ id: 'b1', type: 'expense', amount: 30, accountId: 'A', updatedAt: 2000 }],
  tombstones: { bills: [{ id: 'b1', deletedAt: 1500 }] },
});
ok('删除时间早于最后修改 -> 不删', m.bills.some((b) => b.id === 'b1'));

// ---- 3. 账户对象取自远端时的余额 ----
seed();
m = sync.mergeRemote({
  bills: [{ id: 'b4', type: 'income', amount: 100, accountId: 'A', bookId: 'bk', date: '2026-10-04', updatedAt: 6000 }],
  accounts: [{ id: 'A', name: '现金（远端改名）', balance: 300, updatedAt: 9000 }], // 远端更新 -> 赢
});
// 远端余额 300 含远端贡献 +100；扣远端贡献 100 -> 200；加合并贡献(-30-20+100 = 50) -> 250
eq('账户取自远端时按远端侧重算', m.accounts[0].balance, 250);
eq('账户名取远端新值', m.accounts[0].name, '现金（远端改名）');

// ---- 4. 设置与当前账本保留本机 ----
seed();
m = sync.mergeRemote({ bills: [], settings: { theme: 'light', sync: { token: 'bad' } }, currentBookId: 'other' });
eq('settings 保留本机', m.settings.theme, 'dark');
eq('token 不被远端污染', m.settings.sync.token, 'tk');
eq('currentBookId 保留本机', m.currentBookId, 'bk');

// ---- 5. hasLocalChanges ----
seed();
store.S().settings.sync.baseSyncedAt = 1500;
ok('有晚于基线的账单 -> 判定有改动', sync.hasLocalChanges() === true);
store.S().settings.sync.baseSyncedAt = 99999;
ok('全部早于基线 -> 判定无改动', sync.hasLocalChanges() === false);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exitCode = 1;
