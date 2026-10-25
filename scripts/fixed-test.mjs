// 固定支出 + 可支配金额 回归测试
//
// 这套数字的口径是产品决策，不是纯算术，所以每条都写成断言钉住：
//   收入 − 固定支出（月摊）＝ 可分配
//   可分配 里划出「每月可用额度」，剩下的 ＝ 预计可存
//   浮动支出 = 本月总支出 − 归到固定项的金额（固定项按计划封顶，多缴的部分仍算浮动）
const mem = new Map();
globalThis.localStorage = {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => mem.set(k, String(v)),
  removeItem: (k) => mem.delete(k),
};

const store = await import('../js/store.js');
const fx = await import('../js/fixed.js');

let pass = 0; let fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log('OK   ' + name); }
  else { fail++; console.log('FAIL ' + name + (extra ? ' — ' + extra : '')); }
};
const near = (a, b) => Math.abs((a || 0) - (b || 0)) < 0.005;

const st = store.load();
const S = store.S();
const acc = st.accounts[0];
const YM = '2026-05';
const reset = () => { st.bills.length = 0; st.fixedCosts.length = 0; S.settings.spendCap = 0; };
// amount 未传时默认 0，避免每笔都写一遍
const bill = (o) => store.addBill({
  accountId: acc.id, date: `${YM}-05`, type: 'expense', amount: 0, ...o,
});
const item = (o) => fx.addFixed({ name: 'x', amount: 0, cycle: 'month', keywords: [], active: true, ...o });

// ---------- 1. 月周期折算 ----------
ok('每月 = 原值', fx.monthAmount({ amount: 300, cycle: 'month' }) === 300);
ok('每季 / 3', near(fx.monthAmount({ amount: 900, cycle: 'quarter' }), 300));
ok('每年 / 12', near(fx.monthAmount({ amount: 1200, cycle: 'year' }), 100));
ok('未知周期按每月算', fx.monthAmount({ amount: 500, cycle: 'xxx' }) === 500);
ok('金额缺失不算 NaN', fx.monthAmount({}) === 0);

// ---------- 2. 关键词归集 ----------
reset();
const parking = item({ name: '停车费', amount: 300, keywords: ['停车', '车位'] });
const power = item({ name: '水电', amount: 200, keywords: ['电费', '水费'] });
bill({ amount: 300, note: '小区停车月租' });
bill({ amount: 200, note: '国家电网 电费' });
bill({ amount: 40, note: '楼下咖啡' });
let m = fx.monthly(YM);
const byId = () => Object.fromEntries(m.items.map((i) => [i.item.id, i]));
ok('命中「停车」算已缴', byId()[parking.id].state === 'paid', JSON.stringify(byId()[parking.id]));
ok('命中「电费」算已缴', byId()[power.id].state === 'paid');
ok('归集金额按实付计', near(byId()[power.id].paid, 200));
ok('未命中的不算到固定项', near(m.flex, 40), `flex=${m.flex}`);
ok('固定支出计划合计 = 月摊相加', near(m.fixedPlan, 500));
ok('已缴合计', near(m.fixedPaid, 500));
ok('固定已缴 + 浮动 = 本月总支出', near(m.fixedPaid + m.flex, m.expense), `${m.fixedPaid}+${m.flex} vs ${m.expense}`);

// 大小写不敏感：导入的账单备注里中英文混排很常见
reset();
item({ name: '物业费', amount: 400, keywords: ['PROPERTY'] });
bill({ amount: 400, note: 'property fee 物业费' });
ok('关键词大小写不敏感', fx.monthly(YM).items[0].state === 'paid');

// ---------- 3. 一笔账单只归一项（否则金额会被算两遍）----------
reset();
const a1 = item({ name: '水电', amount: 200, keywords: ['水电'] });
const a2 = item({ name: '电费', amount: 100, keywords: ['电费'] });
bill({ amount: 150, note: '水电费代扣' });
m = fx.monthly(YM);
const sumPaid = m.items.reduce((s, i) => s + i.paid, 0);
ok('重复命中只算一次', near(sumPaid, 150), `合计 ${sumPaid}`);
ok('归给第一个命中的项', byId()[a1.id].paid === 150 && byId()[a2.id].paid === 0);

// ---------- 4. 已缴 / 部分 / 未缴 ----------
reset();
const b1 = item({ name: '房租', amount: 2000, keywords: ['房租'] });
bill({ amount: 1200, note: '房租（先付一半）' });
ok('付一部分 → partial', fx.monthly(YM).items[0].state === 'partial');
reset();
item({ name: '房租', amount: 2000, keywords: ['房租'] });
bill({ amount: 1999.5, note: '房租' });
ok('差 5 毛算已缴（水电每月都浮动几毛）', fx.monthly(YM).items[0].state === 'paid');
reset();
item({ name: '房租', amount: 2000, keywords: ['房租'] });
ok('一笔都没付 → unpaid', fx.monthly(YM).items[0].state === 'unpaid');
ok('unpaid 会进待缴清单', fx.monthly(YM).unpaid.length === 1);

// ---------- 5. 超缴按计划封顶，多出的仍算浮动 ----------
reset();
item({ name: '停车费', amount: 300, keywords: ['停车'] });
bill({ amount: 380, note: '停车（补了上月的）' });
m = fx.monthly(YM);
ok('已缴不超过计划', near(m.fixedPaid, 300), `fixedPaid=${m.fixedPaid}`);
ok('超出的 80 算浮动支出', near(m.flex, 80), `flex=${m.flex}`);
ok('flex 不会被算成负数', fx.monthly(YM).flex >= 0);

// ---------- 6. 收入 / 转账不参与归集 ----------
reset();
item({ name: '停车费', amount: 300, keywords: ['停车'] });
bill({ amount: 300, note: '停车', type: 'income' });
ok('收入不算固定支出', fx.monthly(YM).items[0].paid === 0);
bill({ amount: 300, note: '停车', type: 'transfer', toAccountId: st.accounts[1].id });
ok('转账不算固定支出', fx.monthly(YM).items[0].paid === 0);

// ---------- 7. 停用项不参与 ----------
reset();
item({ name: '宽带', amount: 100, keywords: ['宽带'] });
item({ name: '旧房租', amount: 1500, keywords: ['房租'], active: false });
ok('停用项不计入计划', near(fx.monthly(YM).fixedPlan, 100));
ok('停用项不进列表', fx.monthly(YM).items.length === 1);

// ---------- 8. 跨月不串台 ----------
reset();
item({ name: '停车费', amount: 300, keywords: ['停车'] });
bill({ amount: 300, note: '停车', date: '2026-04-05' });
ok('上月的账不算本月已缴', fx.monthly(YM).items[0].paid === 0);
bill({ amount: 300, note: '停车', date: `${YM}-08` });
ok('本月的账照常归集', fx.monthly(YM).items[0].paid === 300);

// ---------- 9. 可支配口径 ----------
reset();
item({ name: '停车费', amount: 500, keywords: ['停车'] });
item({ name: '水电', amount: 300, keywords: ['水电'] });
bill({ amount: 500, note: '停车' });
bill({ amount: 320, note: '水电' });
bill({ amount: 180, note: '吃饭' });
store.addBill({ accountId: acc.id, date: `${YM}-01`, type: 'income', amount: 12000 });
m = fx.monthly(YM);
ok('收入', near(m.income, 12000));
ok('固定支出计划 = 800', near(m.fixedPlan, 800));
ok('浮动支出 = 吃饭 180 + 水电超缴 20', near(m.flex, 200), `flex=${m.flex}`);
ok('可分配 = 收入 − 固定支出 = 11200', near(m.allocatable, 11200), `${m.allocatable}`);
ok('未设额度时额度 = 可分配', near(m.cap, 11200) && m.capIsDefault);
ok('未设额度时预计可存 0', near(m.expectSave, 0));
ok('还能花 = 额度 − 浮动 = 11000', near(m.left, 11000), `${m.left}`);
ok('实际存下 = 收入 − 总支出 = 11000', near(m.actualSave, 11000), `${m.actualSave}`);
ok('固定项全缴清，待缴为 0', m.unpaid.length === 0);

S.settings.spendCap = 4000;
m = fx.monthly(YM);
ok('设了额度就按额度', near(m.cap, 4000) && !m.capIsDefault);
ok('预计可存 = 可分配 − 额度 = 7200', near(m.expectSave, 7200), `${m.expectSave}`);
ok('还能花 = 额度 − 浮动 = 3800', near(m.left, 3800), `${m.left}`);

S.settings.spendCap = 100;   // 额度比已花的还少
m = fx.monthly(YM);
ok('超支时还能花为负', m.left < 0 && near(m.left, -100), `${m.left}`);

// 没有收入时，可分配是负数 → 额度不能跟着变负（否则「还能花」会变成一个正数，看着像还有钱）
reset();
item({ name: '房租', amount: 3000, keywords: ['房租'] });
m = fx.monthly(YM);
ok('无收入时可分配为负', near(m.allocatable, -3000));
ok('无收入时额度夹到 0', m.cap === 0, `${m.cap}`);

// ---------- 10. 增删改 ----------
reset();
const f = item({ name: '健身房', amount: 200 });
ok('新增后写进 state', (S.fixedCosts || []).length === 1 && f.id);
ok('新增带 updatedAt', f.updatedAt > 0);
const before = f.updatedAt;
fx.updateFixed(f.id, { amount: 260 });
ok('改金额生效', fx.monthAmount(f) === 260);
ok('改动刷新 updatedAt', f.updatedAt >= before);
ok('改不存在的 id 不炸', fx.updateFixed('nope', { amount: 1 }) === undefined);
fx.removeFixed(f.id);
ok('删除后清空', (S.fixedCosts || []).length === 0);
ok('删不存在的 id 返回 null', fx.removeFixed('nope') === null);

// ---------- 11. 老数据迁移 ----------
// store 是单例、load() 还有缓存，用带 query 的 specifier 换一个全新实例来跑老数据
mem.set('icost.state.v1', JSON.stringify({
  schema: 1, currentBookId: 'b1',
  books: [{ id: 'b1', name: '默认账本' }],
  accounts: [{ id: 'a1', name: '现金', balance: 0 }],
  categories: { expense: [], income: [] },
  bills: [], settings: {}, tombstones: { bills: [] },
}));
const store2 = await import('../js/store.js?fresh=1');
const mig = store2.load();
ok('迁移补 fixedCosts', Array.isArray(mig.fixedCosts));
ok('迁移补 spendCap', mig.settings.spendCap === 0);
ok('迁移补 fixedCosts 墓碑桶', Array.isArray(mig.tombstones.fixedCosts));
ok('fixedCosts 参与同步集合', store.TOMB_KEYS.includes('fixedCosts'));

console.log(`\n通过 ${pass} / 失败 ${fail}`);
process.exitCode = fail ? 1 : 0;
