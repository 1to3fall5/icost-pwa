// 统计 Tab：周期切换（周/月/年/全部/范围）+ 收支、报销、流转、趋势、分类统计
import Icons from '../icons.js';
import {
  S, curBook, cats, accById, bookBills, fmtMoney, ymLabel, shiftMonth, monthOf,
  accountStat, pad2,
} from '../store.js';
import { donut, bars, line, rankList } from '../charts.js';
import { go, onCleanup, UI } from '../app.js';
import { uiMark } from '../uiicon.js';

const MODES = [
  { v: 'week', t: '周' }, { v: 'month', t: '月' }, { v: 'year', t: '年' },
  { v: 'all', t: '全部' }, { v: 'range', t: '范围' },
];
const NET_KINDS = [{ v: 'net', t: '净资产' }, { v: 'asset', t: '总资产' }, { v: 'debt', t: '总负债' }];

// 页面级状态（模块内持久化，返回本页时保留选择）
const st = {
  mode: 'month',                 // week | month | year | all | range
  ym: null,                      // 月/年锚点
  day: null,                     // 周模式锚点日期
  range: { from: '', to: '' },   // 自定义范围
  netKind: 'net',                // 净资产趋势：net | asset | debt
  dtype: 'expense',              // 分类详情：expense | income
};
const view = { root: null };

// ---------- 日期工具 ----------
const iso = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
const todayISO = () => iso(new Date());
const curYM = () => st.ym || monthOf(todayISO());
const anchorDay = () => st.day || todayISO();
const ymLastDay = (ym) => { const [y, m] = ym.split('-').map(Number); return new Date(y, m, 0).getDate(); };
const daySpan = (a, b) => Math.round((new Date(b.replace(/-/g, '/')) - new Date(a.replace(/-/g, '/'))) / 864e5) + 1;
const mnum = (k) => +k.slice(5, 7);
const dnum = (k) => +k.slice(8, 10);

function rangeOf(mode = st.mode) {
  const t = todayISO();
  if (mode === 'week') {
    const d = new Date(anchorDay().replace(/-/g, '/'));
    const back = (d.getDay() + 6) % 7;                 // 周一为一周起点
    const a = new Date(d); a.setDate(d.getDate() - back);
    const b = new Date(a); b.setDate(a.getDate() + 6);
    return { from: iso(a), to: iso(b) };
  }
  if (mode === 'month') { const ym = curYM(); return { from: ym + '-01', to: ym + '-' + pad2(ymLastDay(ym)) }; }
  if (mode === 'year') { const y = curYM().slice(0, 4); return { from: y + '-01-01', to: y + '-12-31' }; }
  if (mode === 'range') return { from: st.range.from || t, to: st.range.to || t };
  return { from: '0000-01-01', to: '9999-12-31' };      // all：不限时间
}

function spanLabel() {
  const r = rangeOf();
  if (st.mode === 'all') return '全部';
  if (st.mode === 'year') return `${curYM().slice(0, 4)} 年`;
  if (st.mode === 'month') return ymLabel(curYM());
  if (st.mode === 'week') return `${mnum(r.from)}月${dnum(r.from)}日 - ${mnum(r.to)}月${dnum(r.to)}日`;
  return `${r.from} ~ ${r.to}`;
}
const navOff = () => st.mode === 'all' || st.mode === 'range';

// ---------- 统计口径 ----------
const billsIn = (mode = st.mode) => {
  const r = rangeOf(mode);
  return bookBills(curBook().id).filter((b) => b.date >= r.from && b.date <= r.to);
};

// 分桶：周/月/短范围按天，年/全部/长范围按月
function buckets(mode = st.mode) {
  const r = rangeOf(mode);
  const byDay = mode === 'week' || mode === 'month' || (mode === 'range' && daySpan(r.from, r.to) <= 62);
  if (byDay) {
    const out = [];
    const end = new Date(r.to.replace(/-/g, '/'));
    for (let d = new Date(r.from.replace(/-/g, '/')); d <= end && out.length < 400; d.setDate(d.getDate() + 1)) out.push(iso(d));
    return out.map((k) => ({ key: k, end: k, label: `${mnum(k)}月${dnum(k)}日`, test: (x) => x === k }));
  }
  let list = [];
  let ym = r.from.slice(0, 7);
  let end = r.to.slice(0, 7);
  if (mode === 'all') {                                 // 全部：从最早账单月到当前月
    const all = bookBills(curBook().id);
    ym = all.length ? all[all.length - 1].date.slice(0, 7) : monthOf(todayISO());
    end = monthOf(todayISO());
  }
  let guard = 0;
  while (ym <= end && guard++ < 240) { list.push(ym); ym = shiftMonth(ym, 1); }
  if (!list.length) list.push(monthOf(todayISO()));
  return list.map((k) => ({ key: k, end: k + '-32', label: `${mnum(k)}月`, test: (x) => x.startsWith(k) }));
}

function bucketSums(bks, bills) {
  const exp = bks.map((bk) => bills.filter((b) => b.type === 'expense' && bk.test(b.date)).reduce((s, b) => s + b.amount, 0));
  const inc = bks.map((bk) => bills.filter((b) => b.type === 'income' && bk.test(b.date)).reduce((s, b) => s + b.amount, 0));
  return { exp, inc };
}

function totals() {
  const bills = billsIn();
  let exp = 0, inc = 0;
  bills.forEach((b) => { if (b.type === 'expense') exp += b.amount; else if (b.type === 'income') inc += b.amount; });
  return { bills, exp, inc, balance: inc - exp, daily: exp / elapsedDays(bills) };
}

function elapsedDays(bills) {
  const r = rangeOf();
  const t = todayISO();
  let from = r.from;
  const to = r.to > t ? t : r.to;
  if (st.mode === 'all') {
    if (!bills.length) return 1;
    from = bills[bills.length - 1].date;                // bookBills 已按日期倒序
  }
  if (from < '2000-01-01') return 1;
  return Math.max(1, daySpan(from, to));
}

// 报销：claims 关联账单，落在当前统计范围内
function claimSums(bills) {
  const ids = new Set(bills.map((b) => b.id));
  let pending = 0, done = 0;
  (S().claims || []).forEach((c) => {
    if (!ids.has(c.billId)) return;
    if (c.status === 'done') done += c.amount; else pending += c.amount;
  });
  return { pending, done };
}

// 流转：简化为转账（transfer）账单口径
//   还款 = 转入信用卡/负债账户；收款 = 从信用卡/负债账户转出
function flowSums(bills) {
  let repay = 0, recv = 0;
  bills.filter((b) => b.type === 'transfer').forEach((b) => {
    if (accById(b.toAccountId)?.type === 'credit') repay += b.amount;
    else if (accById(b.accountId)?.type === 'credit') recv += b.amount;
  });
  return { repay, recv };
}

// 净资产/总资产/总负债按日累计（简化）：
//   以账户当前快照为终值，向前扣除「该日之后」账单产生的净影响
function deltaOf(b, kind) {
  if (b.type === 'transfer') return 0;
  const sign = b.type === 'income' ? 1 : b.type === 'expense' ? -1 : 0;
  if (kind === 'asset') return accById(b.accountId)?.type === 'credit' ? 0 : sign * b.amount;
  if (kind === 'debt') return (accById(b.accountId)?.type === 'credit' && b.type === 'expense') ? b.amount : 0;
  return sign * b.amount;
}
function netSeries(bks) {
  const stat = accountStat();
  const base = st.netKind === 'asset' ? stat.asset : st.netKind === 'debt' ? stat.debt : stat.net;
  const all = bookBills(curBook().id);
  return bks.map((bk) => {
    let after = 0;
    all.forEach((b) => { if (b.date > bk.end) after += deltaOf(b, st.netKind); });
    return base - after;
  });
}

// 一级分类
export function topCatOf(id) {
  if (!id) return null;
  for (const t of ['expense', 'income']) {
    const list = cats(t) || [];
    const p = list.find((c) => c.id === id);
    if (p) return p;
    const par = list.find((c) => (c.children || []).some((ch) => ch.id === id));
    if (par) return par;
  }
  return null;
}
export function catAgg(bills, type = 'expense') {
  const map = new Map();
  bills.filter((b) => b.type === type).forEach((b) => {
    const top = topCatOf(b.categoryId);
    const id = top?.id || 'other';
    const cur = map.get(id) || { id, name: top?.name || '其他', icon: top?.icon || '🧾', color: top?.color || '#98989f', value: 0 };
    cur.value += b.amount;
    map.set(id, cur);
  });
  return [...map.values()].sort((a, b) => b.value - a.value);
}
const catItems = () => catAgg(billsIn(), st.dtype);

// ---------- 视图 ----------
const cell = (lb, amt, color) => `
  <div class="stat-cell">
    <div class="lb st-lb-chev">${lb}${Icons.chevR}</div>
    <div class="amt"${color ? ` style="color:${color}"` : ''}>¥${fmtMoney(amt)}</div>
  </div>`;

const cardHead = (ic, title, extra = '') => `
  <div class="card-title-row">
    ${uiMark(ic, 'badge-ic')}
    <span class="card-title">${title}</span>
    ${extra}
  </div>`;

function bodyHTML() {
  const { bills, exp, inc, balance, daily } = totals();
  const cl = claimSums(bills);
  const fl = flowSums(bills);
  const bks = buckets();
  const { exp: expSeries } = bucketSums(bks, bills);
  const avg = bks.length ? exp / bks.length : 0;
  const ns = netSeries(bks);
  const lastVal = ns.length ? ns[ns.length - 1] : 0;
  const items = catItems();
  const total = items.reduce((s, i) => s + i.value, 0);

  // page-stats：桌面下卡片两两并排成双栏，手机端仍为单列
  return `
  <div class="page-stats">
  <div class="seg" data-seg="mode">
    ${MODES.map((m) => `<button data-v="${m.v}" class="${m.v === st.mode ? 'on' : ''}">${m.t}</button>`).join('')}
  </div>

  <div class="month-row" style="justify-content:space-between">
    <button class="round-nav${navOff() ? ' gray' : ''}" data-m="-1">${Icons.chevL}</button>
    <span class="month-label">${spanLabel()}</span>
    <button class="round-nav${navOff() ? ' gray' : ''}" data-m="1">${Icons.chevR}</button>
  </div>

  <div class="card st-tap" data-open="expense">
    ${cardHead('pie', '收支统计', `<span class="chevron">${Icons.chevR}</span>`)}
    <div class="stat-grid">
      ${cell('支出', exp)}
      ${cell('收入', inc)}
      ${cell('结余', balance, balance < 0 ? 'var(--red)' : '')}
      ${cell('日均支出', daily)}
    </div>
  </div>

  <div class="card">
    ${cardHead('receipt-refund', '报销统计')}
    <div class="stat-grid">
      ${cell('待报销', cl.pending, cl.pending ? 'var(--orange)' : '')}
      ${cell('报销入账', cl.done)}
    </div>
  </div>

  <div class="card">
    ${cardHead('swap', '流转统计')}
    <div class="stat-grid">
      ${cell('还款', fl.repay)}
      ${cell('收款', fl.recv)}
    </div>
  </div>

  <div class="card">
    ${cardHead('chart', '支出统计图', `<span class="st-note">平均值: ¥${fmtMoney(avg)}</span><span class="st-ic">${Icons.chart}</span>`)}
    <div class="chart-wrap"><canvas class="chart" id="st-bars"></canvas></div>
  </div>

  <div class="card">
    ${cardHead('building-bank', '净资产趋势图')}
    <div class="chart-wrap st-wrap-top">
      <div class="chart-tip" id="st-tip">${bks.length ? bks[bks.length - 1].label : ''} ¥${fmtMoney(lastVal)}</div>
      <canvas class="chart" id="st-line"></canvas>
    </div>
    <div class="seg small" data-seg="net" style="margin:12px 0 0">
      ${NET_KINDS.map((k) => `<button data-v="${k.v}" class="${k.v === st.netKind ? 'on' : ''}">${k.t}</button>`).join('')}
    </div>
  </div>

  <div class="card">
    ${cardHead('category', '支出分类详情',
      `<button class="pill-btn" data-pill="ratio">显示环比金额</button>
       <button class="pill-btn" data-pill="level">一级分类</button>`)}
    <div class="chart-wrap"><canvas class="chart" id="st-donut"></canvas></div>
    <div class="seg small" data-seg="dtype" style="margin:12px 0 0">
      <button data-v="expense" class="${st.dtype === 'expense' ? 'on' : ''}">支出</button>
      <button data-v="income" class="${st.dtype === 'income' ? 'on' : ''}">收入</button>
    </div>
    <div id="st-rank" class="st-list"></div>
  </div>
  </div>`;
}

function draw() {
  const root = view.root;
  if (!root) return;
  const bills = billsIn();
  const bks = buckets();
  const { exp } = bucketSums(bks, bills);
  bars(root.querySelector('#st-bars'), exp.length ? exp : [0]);

  const ns = netSeries(bks);
  const labels = [0, 0.25, 0.5, 0.75, 1].map((f) => bks[Math.round(f * (bks.length - 1))]?.label || '');
  line(root.querySelector('#st-line'), ns.length ? ns : [0, 0], bks.length ? labels : ['']);
  const tip = root.querySelector('#st-tip');
  if (tip) tip.textContent = `${bks.length ? bks[bks.length - 1].label : ''} ¥${fmtMoney(ns.length ? ns[ns.length - 1] : 0)}`;

  const items = catItems();
  const total = items.reduce((s, i) => s + i.value, 0);
  donut(root.querySelector('#st-donut'), items,
    st.dtype === 'expense' ? '总支出 ⇆' : '总收入 ⇆', `¥${fmtMoney(total)}`);
  const rank = root.querySelector('#st-rank');
  if (rank) rankList(rank, items, total);
  return items;
}

function bind() {
  const root = view.root;

  root.querySelectorAll('[data-seg="mode"] button').forEach((b) => b.addEventListener('click', async () => {
    const v = b.dataset.v;
    if (v === 'range' && !st.range.from) {
      const r = await pickRange();
      if (!r) return;
      st.range = r;
    }
    st.mode = v;
    paint();
  }));

  root.querySelectorAll('.round-nav[data-m]').forEach((b) => b.addEventListener('click', () => {
    const d = +b.dataset.m;
    if (navOff()) return;
    if (st.mode === 'week') {
      const a = new Date(anchorDay().replace(/-/g, '/'));
      a.setDate(a.getDate() + d * 7);
      st.day = iso(a);
    } else if (st.mode === 'year') {
      st.ym = shiftMonth(curYM(), d * 12);
    } else {
      st.ym = shiftMonth(curYM(), d);
    }
    paint();
  }));

  root.querySelectorAll('[data-seg="net"] button').forEach((b) => b.addEventListener('click', () => {
    st.netKind = b.dataset.v;
    root.querySelectorAll('[data-seg="net"] button').forEach((x) => x.classList.toggle('on', x === b));
    draw();
  }));

  root.querySelectorAll('[data-seg="dtype"] button').forEach((b) => b.addEventListener('click', () => {
    st.dtype = b.dataset.v;
    root.querySelectorAll('[data-seg="dtype"] button').forEach((x) => x.classList.toggle('on', x === b));
    paint();
  }));

  root.querySelectorAll('[data-pill]').forEach((b) => b.addEventListener('click', () => UI.toast('演示开关')));

  root.querySelector('[data-open]')?.addEventListener('click', () => go('statsdetail', { type: 'expense' }));

  root.querySelectorAll('#st-rank [data-cat]').forEach((r) => r.addEventListener('click', () => {
    go('statsdetail', { type: st.dtype, cat: r.dataset.cat });
  }));
}

function paint() {
  if (!view.root) return;
  view.root.innerHTML = bodyHTML();
  draw();
  bind();
}

// 自定义范围：两个 date 输入
function pickRange() {
  return new Promise((resolve) => {
    const ov = document.createElement('div');
    ov.className = 'overlay';
    ov.innerHTML = `<div class="panel">
      <h3>选择统计范围</h3>
      <div style="display:flex;gap:8px;align-items:center;margin-bottom:12px">
        <input class="form-input" type="date" id="rg-a" value="${st.range.from}" style="flex:1;padding:10px">
        <span style="color:var(--text2)">至</span>
        <input class="form-input" type="date" id="rg-b" value="${st.range.to}" style="flex:1;padding:10px">
      </div>
      <div style="display:flex;gap:10px">
        <button class="form-input" data-r="0" style="flex:1;text-align:center;background:#3a3a3c">取消</button>
        <button class="form-input" data-r="1" style="flex:1;text-align:center;background:#0a84ff;color:#fff">确定</button>
      </div></div>`;
    ov.addEventListener('click', (e) => {
      const r = e.target.dataset.r;
      if (r !== undefined) {
        const a = ov.querySelector('#rg-a').value;
        const b = ov.querySelector('#rg-b').value;
        ov.remove();
        resolve(r === '1' && a && b ? { from: a, to: b } : null);
      } else if (e.target === ov) { ov.remove(); resolve(null); }
    });
    document.getElementById('overlay-root').appendChild(ov);
  });
}

export default {
  header: 'large',
  title: '统计',
  navLeft: '', // 原版统计页左上角无按钮
  navRight: `<button class="nb-btn avatar" data-act="settings">${Icons.avatar}</button>`,
  render() { return bodyHTML(); },
  mount(root) {
    view.root = root;
    draw();
    bind();
    const onResize = () => draw();
    window.addEventListener('resize', onResize);
    onCleanup(() => {
      window.removeEventListener('resize', onResize);
      view.root = null;
    });
  },
  async onNavLeft() {
    const pick = await UI.sheet('统计维度', MODES.map((m) => ({
      label: m.t, value: m.v === st.mode ? '当前' : '', v: m.v,
    })));
    if (pick) { st.mode = pick.v; paint(); }
  },
};
