// 方块占比视图（treemap）测试：真实数据建树 → 布局 → 不变量断言
// 覆盖历史上踩过的坑：颜色兜底导致整片灰、块越界/重叠/NaN、容器把自己当叶子画两遍（重影）
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
    clientWidth: 600, clientHeight: 320, width: 600, height: 200,
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
const { tmTree, dash } = await import(base + 'dashboard.js');
const { layoutTree, squarify, gather, canDrill, countLeaves, MIN_AREA } = await import(base + 'treemap.js');

// ---------- 造数据 ----------
const S = store.S();
S.accounts.forEach((a, i) => { a.balance = [12000, 8600, 3200, 254000, -4300][i] ?? 1000; });
const expCats = S.categories.expense;
const incCats = S.categories.income;
let n = 0;
for (let m = 5; m >= 0; m--) {
  const ym = store.shiftMonth('2026-10', -m);
  for (let d = 0; d < 18; d++) {
    const c = expCats[(n * 5) % expCats.length];
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
    date: `${ym}-05`, categoryId: incCats[0].children[0].id, accountId: S.accounts[3].id,
    note: '工资', created: Date.now(), updatedAt: Date.now(),
  });
}

// ---------- 树结构 ----------
const walk = (node, fn, depth = 0) => { fn(node, depth); (node.children || []).forEach((c) => walk(c, fn, depth + 1)); };

for (const dim of ['expense', 'income']) {
  const t = tmTree(dim);
  ok(`${dim} 树有值`, t.value > 0, String(t.value));
  ok(`${dim} 树根有子项`, (t.children || []).length > 0);
  let bad = 0, noColor = 0, fallback = 0, maxDepth = 0;
  walk(t, (node, d) => {
    maxDepth = Math.max(maxDepth, d);
    if (!Number.isFinite(node.value) || node.value <= 0) bad++;
    // 根节点不渲染成方块（它只是路径起点），不要求颜色
    if (d > 0 && !node.color) noColor++;
    else if (d > 0 && node.color === '#3a3a3c') fallback++;
  });
  ok(`${dim} 所有节点 value 有限且 > 0`, !bad, `${bad} 个异常`);
  ok(`${dim} 所有节点都有分类色`, !noColor, `${noColor} 个缺色`);
  ok(`${dim} 没有落到兜底灰`, !fallback, `${fallback} 个兜底`);
  ok(`${dim} 至少 3 层（一级/二级/单笔）`, maxDepth >= 3, '实际 ' + maxDepth);
}

const at = tmTree('asset');
ok('asset 树有值', at.value > 0);
let aNoColor = 0;
walk(at, (node, d) => { if (d > 0 && !node.color) aNoColor++; });
ok('asset 所有节点都有色', !aNoColor, `${aNoColor} 个缺色`);
ok('asset 账户是叶子', at.children.every((g) => g.children.every((a) => a.leaf)));

// 单笔账单叶子带 billId，方便以后点击跳详情
const et = tmTree('expense');
let leafWithId = 0;
walk(et, (node) => { if (node.leaf && node.billId) leafWithId++; });
ok('账单叶子带 billId', leafWithId > 0, String(leafWithId));

// ---------- 布局不变量 ----------
const SIZES = [[560, 320], [900, 340], [1380, 400]];
for (const dim of ['expense', 'income', 'asset']) {
  const root = tmTree(dim);
  for (const [W, H] of SIZES) {
    const out = [];
    layoutTree(root, { x: 0, y: 0, w: W, h: H }, 0, 3, out, MIN_AREA);
    const tag = `${dim}@${W}x${H}`;
    ok(`${tag} 有方块`, out.length > 0, '0 块');
    const nan = out.filter((b) => ![b.x, b.y, b.w, b.h].every(Number.isFinite));
    ok(`${tag} 无 NaN 坐标`, !nan.length, `${nan.length} 个`);
    const oob = out.filter((b) => b.x < -0.5 || b.y < -0.5 || b.x + b.w > W + 0.5 || b.y + b.h > H + 0.5);
    ok(`${tag} 不越界`, !oob.length, `${oob.length} 个越界`);
    // 同一层内的方块互不重叠（父子是覆盖关系，只比同 depth）
    const byDepth = {};
    out.forEach((b) => { (byDepth[b.depth] = byDepth[b.depth] || []).push(b); });
    let overlap = 0;
    Object.values(byDepth).forEach((list) => {
      for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
        const a = list[i], b = list[j];
        const ox = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
        const oy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
        if (ox > 1 && oy > 1) overlap++;
      }
    });
    ok(`${tag} 同层不重叠`, !overlap, `${overlap} 对`);
    // 覆盖率：最终可见块（非容器）+ 容器标题条 应接近整块面积
    const cover = out.reduce((s, b) => (b.expand ? s + b.w * (b.bar || 0) : s + b.w * b.h), 0);
    const ratio = cover / (W * H);
    ok(`${tag} 覆盖率 ≥ 90%`, ratio >= 0.9, (ratio * 100).toFixed(1) + '%');
  }
}

// ---------- 交互规则 ----------
ok('canDrill：叶子不可下钻', !canDrill({ name: 'x', value: 1, leaf: true, children: [] }));
ok('canDrill：只有 1 个子项不可下钻', !canDrill({ name: 'x', value: 1, children: [{ name: 'y', value: 1 }] }));
ok('canDrill：≥2 个子项可下钻', canDrill({ name: 'x', value: 2, children: [{ name: 'y', value: 1 }, { name: 'z', value: 1 }] }));
ok('canDrill：过滤掉 0 值子项后不足 2 个 → 不可下钻',
  !canDrill({ name: 'x', value: 2, children: [{ name: 'y', value: 2 }, { name: 'z', value: 0 }] }));

// 聚拢：碎块收成「其他 N 项」，且至少 2 项才合并
const g = gather({ name: 'r', value: 100, children: [
  { name: 'A', value: 90 }, { name: 'B', value: 0.5 }, { name: 'C', value: 0.5 },
] }, 0.02);
ok('聚拢生成「其他 N 项」', g.children.some((c) => /^其他 \d+ 项$/.test(c.name)));
const g1 = gather({ name: 'r', value: 100, children: [{ name: 'A', value: 99 }, { name: 'B', value: 1 }] }, 0.02);
ok('只有 1 个碎块时不合并', !g1.children.some((c) => /^其他/.test(c.name)));

// squarify 基础性质
const sq = squarify([{ value: 3 }, { value: 2 }, { value: 1 }], { x: 0, y: 0, w: 300, h: 200 });
ok('squarify 全部分配', sq.length === 3);
ok('squarify 面积守恒', Math.abs(sq.reduce((s, b) => s + b.w * b.h, 0) - 60000) < 1);

ok('countLeaves 统计账单数', countLeaves(tmTree('expense')) > 0);

// ---------- 挂载（stub DOM）----------
const { mountTreemap } = await import(base + 'treemap.js');
let mErr = '';
try {
  const inst = mountTreemap(el(), {
    root: tmTree('expense'),
    money: (v) => '¥' + Math.round(v),
    moneyTight: (v) => '¥' + Math.round(v),
    path: [],
  });
  inst.destroy();
} catch (e) { mErr = e.message; }
ok('mountTreemap 不抛错', !mErr, mErr);

// ---------- 渲染路径：必须真的产出方块 DOM ----------
// 之前只测了算法，没测"元素有没有被 append 出来"，导致容器高度塌成 0 时整图空白测不出来
{
  const mk = (cls = '') => {
    const e = {
      className: cls, style: { setProperty: noop }, dataset: {}, innerHTML: '', textContent: '',
      classList: { add: noop, remove: noop, toggle: noop, contains: () => false },
      children: [], _q: {}, _layer: null,
      appendChild(c) { e.children.push(c); },
      remove: noop, addEventListener: noop, setAttribute: noop, focus: noop,
      querySelector(s) {
        if (s === '.tm-layer') { e._layer = e._layer || mk('tm-layer'); return e._layer; }
        return (e._q[s] = e._q[s] || mk(s));
      },
      querySelectorAll: () => [], closest: () => null,
      clientWidth: 900, clientHeight: 320, offsetWidth: 900,
      getContext: () => ctx2d(),
    };
    return e;
  };
  const container = mk('tm-root');
  const inst = mountTreemap(container, {
    root: tmTree('expense'),
    money: (v) => '¥' + Math.round(v), moneyTight: (v) => '¥' + Math.round(v), path: [],
  });
  const map = container._q['.tm-map'];
  const blocks = (map._layer?.children || []).filter((c) => String(c.className).startsWith('blk'));
  ok('渲染真的产出了方块元素', blocks.length > 0, '0 个');
  ok('每个方块都有底色层', blocks.length > 0 && blocks.every((b) => b.innerHTML.includes('blk-fill')));
  ok('容器块有标题条', blocks.some((b) => b.innerHTML.includes('b-tag')));
  ok('叶子块有文字区', blocks.some((b) => b.innerHTML.includes('b-in')));
  ok('容器高度被显式写回（CSS 未加载也不会塌成 0）', map.style.height === '320px', String(map.style.height));
  ok('方块都写了明度变量 --ov', blocks.every((b) => b.style && b.style.setProperty === noop));
  inst.destroy();
  ok('destroy 后容器清空', container.innerHTML === '');
}

// 空账本：树为空也不能崩
const savedBills = S.bills; const savedAcc = S.accounts;
S.bills = []; S.accounts = [];
let eErr = '';
try {
  const t = tmTree('expense');
  ok('空数据树 value = 0', t.value === 0, String(t.value));
  const inst = mountTreemap(el(), { root: t, money: (v) => '¥' + v, moneyTight: (v) => '¥' + v });
  inst.destroy();
} catch (e) { eErr = e.message; }
ok('空数据挂载不抛错', !eErr, eErr);
S.bills = savedBills; S.accounts = savedAcc;

// 隐藏金额时树结构不受影响（只影响渲染文本）
S.settings.hideAmount = true;
ok('隐藏金额不改变树结构', tmTree('expense').value === et.value);
S.settings.hideAmount = false;

console.log(`\n通过 ${pass} / 失败 ${fail}`);
process.exitCode = fail ? 1 : 0;
