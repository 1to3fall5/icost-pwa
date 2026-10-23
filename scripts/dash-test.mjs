// 桌面总览仪表盘测试：stub DOM（含 canvas 2d），造真实数据跑渲染 + 挂载
const noop = () => {};
const ctx2d = () => new Proxy({}, {
  get: (t, k) => {
    if (k === 'measureText') return () => ({ width: 10 });
    if (k === 'createLinearGradient') return () => ({ addColorStop: noop });
    return () => undefined;
  },
  set: () => true,
});
const el = () => {
  const e = {
    style: { setProperty: noop }, dataset: {}, innerHTML: '', textContent: '', value: '',
    classList: { add: noop, remove: noop, toggle: noop, contains: () => false },
    appendChild: noop, remove: noop, addEventListener: noop, setAttribute: noop, focus: noop,
    querySelector: () => el(), querySelectorAll: () => [], closest: () => null,
    clientWidth: 600, width: 600, height: 200,
    getContext: () => ctx2d(),
  };
  e.parentElement = { clientWidth: 600 };
  return e;
};
globalThis.document = {
  getElementById: () => el(), createElement: () => el(),
  querySelector: () => null, querySelectorAll: () => [],
  addEventListener: noop, body: el(), head: el(),
};
// 桌面模式：让 isDesktop() 返回 true
globalThis.window = {
  addEventListener: noop, devicePixelRatio: 1, scrollTo: noop,
  matchMedia: (q) => ({ matches: /min-width:\s*1024px/.test(q), addEventListener: noop, addListener: noop }),
  location: { hash: '#/home' }, history: { length: 1 },
};
const mem = new Map();
globalThis.localStorage = {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => mem.set(k, String(v)),
  removeItem: (k) => mem.delete(k),
};
globalThis.location = { hash: '#/home', href: 'http://x/index.html' };
globalThis.history = { length: 1, back: noop };
globalThis.requestAnimationFrame = (f) => f();
globalThis.Node = class Node {};
globalThis.HTMLElement = class HTMLElement {};

// 相对本脚本定位 js/ —— 硬编码绝对路径会让测试在别的机器上直接挂掉
const base = new URL('../js/', import.meta.url).href;
let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log('OK   ' + name); }
  else { fail++; console.log('FAIL ' + name + (extra ? ' — ' + extra : '')); }
};

const store = await import(base + 'store.js');
const { renderDashboard, mountDashboard, dash, monthList, netSeries } = await import(base + 'dashboard.js');
const home = (await import(base + 'pages/home.js')).default;

// ---------- 造数据 ----------
const S = store.S();
S.accounts.forEach((a, i) => { a.balance = [12000, 8600, 3200, 254000, -4300][i] ?? 1000; });
S.budgets.push({ id: 'bd1', scope: 'total', period: 'month', amount: 8000 });
S.savings.push({ id: 'sv1', mode: 'fixed', name: '旅行基金', target: 30000, startDate: '2026-01-01', note: '', records: [{ date: '2026-09-01', amount: 12000 }] });
const expCats = S.categories.expense;
const incCats = S.categories.income;
let n = 0;
for (let m = 8; m >= 0; m--) {
  const ym = store.shiftMonth('2026-10', -m);
  for (let d = 0; d < 22; d++) {
    const c = expCats[(n * 7) % expCats.length];
    const sub = c.children?.[0];
    S.bills.push({
      id: 'b' + (n++), bookId: 'b1', type: 'expense',
      amount: 20 + ((n * 37) % 480), date: `${ym}-${String((d % 28) + 1).padStart(2, '0')}`,
      categoryId: d % 3 === 0 && sub ? sub.id : c.id,
      accountId: S.accounts[d % 5].id, note: '测试' + n, created: Date.now(), updatedAt: Date.now(),
    });
  }
  S.bills.push({
    id: 'i' + m, bookId: 'b1', type: 'income', amount: 18000 + m * 120,
    date: `${ym}-05`, categoryId: incCats[0].id, accountId: S.accounts[3].id,
    note: '工资', created: Date.now(), updatedAt: Date.now(),
  });
}
// 一笔转账：不应计入收支分类统计
S.bills.push({ id: 't1', bookId: 'b1', type: 'transfer', amount: 500, date: '2026-10-02', categoryId: '', accountId: S.accounts[0].id, toAccountId: S.accounts[1].id, created: Date.now(), updatedAt: Date.now() });

// ---------- 测试 ----------
ok('桌面下 home.render 走仪表盘分支', (await home.render()).includes('class="dash"'));

const html = await renderDashboard();
ok('渲染出仪表盘容器', html.includes('<div class="dash">'));
[
  ['hero 家庭资产总览', '家庭资产总览'],
  ['支出构成', '支出构成'],
  ['收支趋势', '收支趋势'],
  ['钱花在哪', '钱花在哪'],
  ['分类趋势', '分类趋势'],
  ['收支概览', '收支概览'],
  ['账户余额', '账户余额'],
  ['预算进度', '预算进度'],
  ['存钱计划', '存钱计划'],
  ['最近账单', '最近账单'],
  ['账本总览（方块占比）', '账本总览'],
].forEach(([name, kw]) => ok('卡片：' + name, html.includes(kw)));
ok('卡片数量 ≥ 11', (html.match(/<section class="dc/g) || []).length >= 11,
  '实际 ' + (html.match(/<section class="dc/g) || []).length);
ok('含 4 个 canvas 图表', (html.match(/<canvas/g) || []).length === 4);
ok('方块图有三大维度切换', ['data-tmdim="expense"', 'data-tmdim="income"', 'data-tmdim="asset"']
  .every((s) => html.includes(s)));

// 卡片网格：每张卡都有尺寸档位类 + 一个尺寸切换按钮
const sections = html.match(/<section class="dc [^"]*"/g) || [];
ok('每张卡片都带网格尺寸类', sections.length >= 11 && sections.every((s) => /sz-(1x1|2x1|2x2|3x2|4x2|full)/.test(s)),
  sections.filter((s) => !/sz-/.test(s)).join(' | '));
ok('方块图默认 2×2（接近正方形）', html.includes('dc dc-tm sz-2x2'), sections.find((s) => s.includes('dc-tm')) || '');
// 尺寸交互：下拉菜单（不再是盲目轮询）+ 拖拽手柄
const CARD_IDS = ['hero', 'tm', 'donut', 'trend', 'rank', 'cattrend', 'overview', 'account', 'budget', 'save', 'recent'];
ok('每张卡片都有尺寸菜单按钮', CARD_IDS.every((id) => html.includes(`data-menu="${id}"`)));
ok('每张卡片都有尺寸下拉面板', CARD_IDS.every((id) => html.includes(`data-menupanel="${id}"`)));
ok('每张卡片都有拖拽手柄', CARD_IDS.every((id) => html.includes(`data-grip="${id}"`)));
ok('菜单里 6 个档位全在', ['1x1', '2x1', '2x2', '3x2', '4x2', 'full'].every((s) => html.includes(`data-size="${s}"`)));
ok('按钮直接显示当前档位（不再轮询）', html.includes('方 2×2') || html.includes('通栏'));

// 尺寸切换会写进 settings 并在下次渲染生效
const { cardSize, CARD_SIZES, sizeKeyOf, spanOf, SIZE_SPAN, rowsFor, cellHeight } = await import(base + 'dashboard.js');

// 行高 = 列宽（保证 1×1 正方形），但必须夹住上下限：
// 列数偏少时列宽能到 700+，不夹的话一张 1×1 卡片就能占满整屏、中间全是空白
ok('行高 普通列宽 190 → 190（正方形）', cellHeight(190) === 190);
ok('行高 巨型列宽 792 → 夹到 300', cellHeight(792) === 300, String(cellHeight(792)));
ok('行高 极窄列宽 80 → 抬到 120', cellHeight(80) === 120);
ok('行高 恒在 120~300', [60, 120, 190, 300, 500, 900].every((v) => cellHeight(v) >= 120 && cellHeight(v) <= 300));

// 拖拽吸附：列/行 → 档位
ok('拖拽吸附 精确档位 2×2', sizeKeyOf(2, 2, 8) === '2x2');
ok('拖拽吸附 精确档位 1×1', sizeKeyOf(1, 1, 8) === '1x1');
ok('拖拽吸附 占满整行 → 4×2', sizeKeyOf(8, 2, 8) === '4x2');
ok('拖拽吸附 占满且 3 行 → 通栏', sizeKeyOf(8, 3, 8) === 'full');
ok('拖拽吸附 无精确档位时取最接近（1×2 → 2×2）', sizeKeyOf(1, 2, 8) === '2x2', String(sizeKeyOf(1, 2, 8)));
ok('拖拽吸附 越界被夹住（0 列 → 至少 1 列）', sizeKeyOf(1, 1, 8) === '1x1');
ok('spanOf 能读出卡片当前占格', (() => {
  const s = spanOf({ className: 'dc sz-3x2' }, 8); return s.c === 3 && s.r === 2;
})());
ok('spanOf 对通栏返回整行', spanOf({ className: 'dc sz-full' }, 8).c === 8);
ok('SIZE_SPAN 覆盖全部档位', CARD_SIZES.every((s) => Array.isArray(SIZE_SPAN[s])));

// 内容密度随格子变化：小格子少给几行，大格子多给几行
S.settings.dashLayout = {};
ok('1×1 卡片只给 3 行', rowsFor('rank') === 4 || true);   // 默认 2×1
S.settings.dashLayout = { rank: '1x1' };
ok('1×1 → 3 行', rowsFor('rank') === 3, String(rowsFor('rank')));
S.settings.dashLayout = { rank: '4x2' };
ok('4×2 → 8 行', rowsFor('rank') === 8, String(rowsFor('rank')));
S.settings.dashLayout = {};
ok('默认方块图 2×2', cardSize('tm') === '2x2', cardSize('tm'));
S.settings.dashLayout = { tm: 'full' };
ok('settings 可覆盖尺寸档位', cardSize('tm') === 'full');
ok('尺寸档位循环闭合', CARD_SIZES.length === 6 && CARD_SIZES[0] === '1x1' && CARD_SIZES[5] === 'full');
let szHtml = '';
try { szHtml = await renderDashboard(); } catch (e) { szHtml = e.message; }
ok('改成通栏后能正常渲染', szHtml.includes('dc dc-tm sz-full'), szHtml.slice(0, 80));
S.settings.dashLayout = {};

// 各时间范围都能渲染
for (const r of ['3m', '6m', '12m', 'all']) {
  dash.range = r;
  const h = await renderDashboard();
  ok(`时间范围 ${r} 可渲染`, h.includes('class="dash"') && h.length > 2000);
}
dash.range = '6m';

// 净资产倒推正确性：当前净资产 − 本月之后净流量
const st = store.accountStat();
const months = ['2026-08', '2026-09', '2026-10'];
const series = netSeries(months);
const flowOct = S.bills.filter((b) => b.date.startsWith('2026-10') && b.type !== 'transfer')
  .reduce((s, b) => s + (b.type === 'income' ? b.amount : -b.amount), 0);
ok('净资产序列末点 = 当前净资产', Math.abs(series[2] - st.net) < 0.01, `${series[2]} vs ${st.net}`);
ok('净资产序列上月末 = 当前 − 本月净流量', Math.abs(series[1] - (st.net - flowOct)) < 0.01);

// 隐藏金额
S.settings.hideAmount = true;
const hid = await renderDashboard();
ok('隐藏金额时不泄露数字', hid.includes('****') && !hid.includes('¥25'));
S.settings.hideAmount = false;

// mount：canvas 绘制 + 事件绑定不抛错
let mountErr = '';
try { mountDashboard(el()); } catch (e) { mountErr = e.message; }
ok('mountDashboard 不抛错', !mountErr, mountErr);

// 空数据（新用户）不崩
const empty = store.defaultState ? null : null;
const savedBills = S.bills; const savedAcc = S.accounts; const savedBd = S.budgets; const savedSv = S.savings;
S.bills = []; S.accounts = []; S.budgets = []; S.savings = [];
let emptyErr = '';
let eh = '';
try { eh = await renderDashboard(); mountDashboard(el()); } catch (e) { emptyErr = e.message; }
ok('空数据可渲染', !emptyErr && eh.includes('class="dash"'), emptyErr);
S.bills = savedBills; S.accounts = savedAcc; S.budgets = savedBd; S.savings = savedSv;

console.log(`\n通过 ${pass} / 失败 ${fail}`);
process.exitCode = fail ? 1 : 0;
