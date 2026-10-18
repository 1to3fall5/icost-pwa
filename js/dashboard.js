// 桌面网页版「总览仪表盘」（≥1024px 专用）
// 手机 / iOS PWA 完全走 home.js 的单列流水，本模块不会被加载或渲染。
import Icons from './icons.js';
import {
  S, curBook, bookBills, monthSum, carryOver, fmtMoney, ymLabel, shiftMonth,
  monthOf, catById, accById, accountStat, pad2,
} from './store.js';
import { donut, line, dualBars, multiLine } from './charts.js';
import { go, UI, onCleanup } from './app.js';
import { syncCfg, fmtTime } from './sync.js';

const today = () => new Date().toISOString().slice(0, 10);
const curYM = () => monthOf(today());

// 页面级状态：时间范围（影响走势图 + 账单分析）
const RANGES = [
  { v: '3m', t: '近3月', n: 3 },
  { v: '6m', t: '近6月', n: 6 },
  { v: '12m', t: '近12月', n: 12 },
  { v: 'all', t: '全部', n: 0 },
];
export const dash = { range: '6m', kw: '' };

const hide = () => !!S().settings.hideAmount;
const yuan = (n) => (hide() ? '****' : '¥' + fmtMoney(n));
const plain = (n) => (hide() ? '****' : fmtMoney(n));
const mnum = (k) => +k.slice(5, 7);

// ---------- 时间窗口 ----------
// 返回升序月份数组（长度 n+1，多取一个月用于算环比基准）
export function monthList() {
  const r = RANGES.find((x) => x.v === dash.range) || RANGES[1];
  const end = curYM();
  if (r.v === 'all') {
    const all = bookBills(curBook().id);
    let ym = all.length ? all[all.length - 1].date.slice(0, 7) : end; // bookBills 已倒序
    const out = [];
    let guard = 0;
    while (ym <= end && guard++ < 60) { out.push(ym); ym = shiftMonth(ym, 1); }
    return out.length ? out : [end];
  }
  const out = [];
  for (let i = r.n; i >= 0; i--) out.push(shiftMonth(end, -i));
  return out;
}

// ---------- 净资产走势（无历史快照时按净现金流倒推）----------
// 月末净资产 = 当前净资产 − 该月之后的净现金流之和
export function netSeries(months) {
  const net = accountStat().net;
  const flow = {};
  bookBills(curBook().id).forEach((b) => {
    const ym = b.date.slice(0, 7);
    if (b.type === 'income') flow[ym] = (flow[ym] || 0) + b.amount;
    else if (b.type === 'expense') flow[ym] = (flow[ym] || 0) - b.amount;
  });
  const out = new Array(months.length);
  let acc = 0;
  for (let i = months.length - 1; i >= 0; i--) {
    out[i] = net - acc;
    acc += flow[months[i]] || 0;
  }
  return out;
}

// ---------- 周期内账单 ----------
function billsOf(months) {
  const from = months[0] + '-01';
  const to = months[months.length - 1] + '-32';
  return bookBills(curBook().id).filter((b) => b.date >= from && b.date <= to);
}

function flowByMonth(months, bills) {
  return months.map((ym) => ({
    exp: bills.filter((b) => b.type === 'expense' && b.date.startsWith(ym)).reduce((s, b) => s + b.amount, 0),
    inc: bills.filter((b) => b.type === 'income' && b.date.startsWith(ym)).reduce((s, b) => s + b.amount, 0),
  }));
}

// 一级分类聚合（子分类归到父级）
function catSums(bills, type = 'expense') {
  const map = {};
  bills.filter((b) => b.type === type).forEach((b) => {
    let c = catById(b.categoryId);
    if (c && !c.color) {                       // 二级分类 → 归到一级
      const all = [...S().categories.expense, ...S().categories.income];
      c = all.find((p) => p.children?.some((x) => x.id === c.id)) || c;
    }
    const id = c?.id || 'other';
    map[id] = (map[id] || 0) + b.amount;
  });
  return Object.entries(map)
    .map(([id, value]) => {
      const c = catById(id);
      return { id, value, name: c?.name || '其他', icon: c?.icon || '🧾', color: c?.color || '#98989f' };
    })
    .sort((a, b) => b.value - a.value);
}

// ---------- 卡片 ----------
function heroCard(months) {
  const st = accountStat();
  const series = netSeries(months);
  const cur = series[series.length - 1];
  const prev = series.length > 1 ? series[series.length - 2] : cur;
  const delta = cur - prev;
  const pct = prev ? (delta / Math.abs(prev)) * 100 : 0;
  const up = delta >= 0;
  const ym = curYM();
  const exp = monthSum(curBook().id, ym, 'expense');
  const inc = monthSum(curBook().id, ym, 'income');
  const rate = inc ? ((inc - exp) / inc) * 100 : 0;
  const cfg = syncCfg();
  const syncTxt = cfg.gistId
    ? (cfg.lastSync ? `云端已同步 · ${fmtTime(cfg.lastSync)}` : '已连接云端')
    : '未开启云同步';

  // 资产分布（按账户余额）
  const accs = S().accounts.filter((a) => !a.hidden && !a.archived && a.type !== 'credit' && +a.balance > 0)
    .sort((a, b) => b.balance - a.balance);
  const accTotal = accs.reduce((s, a) => s + a.balance, 0);
  const segs = accs.slice(0, 6).map((a) => ({
    name: a.name, color: a.color || '#0a84ff', value: a.balance,
    pct: accTotal ? (a.balance / accTotal) * 100 : 0,
  }));
  const restAcc = accs.slice(6);
  if (restAcc.length) {
    const v = restAcc.reduce((s, a) => s + a.balance, 0);
    segs.push({ name: '其他账户', color: '#3a3a3c', value: v, pct: accTotal ? (v / accTotal) * 100 : 0 });
  }

  return `
  <section class="dc dc-hero">
    <div class="dc-head">
      <div class="dc-titles">
        <div class="dc-title">家庭资产总览</div>
        <div class="dc-sub">${curBook().name} · ${syncTxt}</div>
      </div>
      <div class="dc-tools">
        <label class="dc-search">${Icons.search.replace('<svg', '<svg style="width:14px;height:14px"')}<input id="dash-kw" placeholder="搜索账单" value="${dash.kw}"></label>
        <div class="seg dc-seg">
          ${RANGES.map((r) => `<button class="${dash.range === r.v ? 'on' : ''}" data-rg="${r.v}">${r.t}</button>`).join('')}
        </div>
      </div>
    </div>

    <div class="hero-top">
      <div class="hero-net-box">
        <div class="hero-label">净资产 <button class="hero-eye" data-act="eye" title="隐藏金额">${hide() ? Icons.eyeOff : Icons.eye}</button></div>
        <div class="hero-net">${yuan(st.net)}</div>
        <div class="hero-delta ${up ? 'up' : 'down'}">
          ${up ? Icons.up : Icons.down}<span>${hide() ? '****' : (up ? '+' : '-') + '¥' + fmtMoney(Math.abs(delta))}　${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%</span>
          <em>较上月</em>
        </div>
      </div>
      <div class="hero-metrics">
        <div class="hm"><span>总资产</span><b>${yuan(st.asset)}</b></div>
        <div class="hm"><span>总负债</span><b class="debt">${yuan(st.debt)}</b></div>
        <div class="hm"><span>本月结余</span><b class="${inc - exp >= 0 ? 'up' : 'down'}">${yuan(inc - exp)}</b></div>
        <div class="hm"><span>本月储蓄率</span><b>${hide() ? '****' : rate.toFixed(0) + '%'}</b></div>
      </div>
    </div>

    <div class="hero-chart"><canvas class="chart" id="dash-net"></canvas></div>

    <div class="hero-dist">
      <div class="hd-head">资产分布</div>
      <div class="hd-bar">${segs.map((s) => `<i style="width:${s.pct}%;background:${s.color}" title="${s.name}"></i>`).join('') || '<i style="width:100%;background:#3a3a3c"></i>'}</div>
      <div class="hd-legend">
        ${segs.map((s) => `<span class="hd-lg"><i style="background:${s.color}"></i>${s.name}<b>${yuan(s.value)}</b><em>${s.pct.toFixed(0)}%</em></span>`).join('')
          || '<span class="hd-lg">暂无账户资产</span>'}
      </div>
    </div>
  </section>`;
}

function donutCard(bills) {
  const items = catSums(bills, 'expense');
  const total = items.reduce((s, i) => s + i.value, 0);
  const top = items.slice(0, 6);
  const rest = items.slice(6);
  const shown = rest.length
    ? [...top, { id: 'rest', name: '其他', icon: '🧾', color: '#3a3a3c', value: rest.reduce((s, i) => s + i.value, 0) }]
    : top;
  return `
  <section class="dc">
    <div class="dc-head"><div class="dc-title">支出构成</div><div class="dc-sub">${bills.length ? '共 ' + bills.length + ' 笔' : '暂无'}</div></div>
    <div class="dc-donut"><canvas class="chart" id="dash-donut"></canvas></div>
    <div class="dc-legend">
      ${shown.length ? shown.map((i) => `<div class="lg-row">
        <i style="background:${i.color}"></i><span>${i.icon} ${i.name}</span>
        <b>${yuan(i.value)}</b><em>${total ? ((i.value / total) * 100).toFixed(1) : '0.0'}%</em>
      </div>`).join('') : '<div class="dc-empty">本区间暂无支出</div>'}
    </div>
  </section>`;
}

function trendCard(months, bills) {
  const f = flowByMonth(months, bills);
  return `
  <section class="dc">
    <div class="dc-head">
      <div class="dc-title">收支趋势</div>
      <div class="dc-sub"><i class="dot exp"></i>支出　<i class="dot inc"></i>收入</div>
    </div>
    <div class="dc-chart"><canvas class="chart" id="dash-flow"></canvas></div>
    <div class="dc-foot">
      ${(() => {
        const e = f.reduce((s, x) => s + x.exp, 0), n = f.reduce((s, x) => s + x.inc, 0);
        return `<span>合计支出 <b class="down">${yuan(e)}</b></span><span>合计收入 <b class="up">${yuan(n)}</b></span>`;
      })()}
    </div>
  </section>`;
}

function rankCard(months, bills) {
  const items = catSums(bills, 'expense');
  const total = items.reduce((s, i) => s + i.value, 0);
  // 环比：紧邻的上一个等长周期
  const n = months.length - 1;
  const pFrom = shiftMonth(months[0], -n);
  const pTo = shiftMonth(months[0], -1);
  const prevBills = bookBills(curBook().id).filter((b) => b.date >= pFrom + '-01' && b.date <= pTo + '-32');
  const prevMap = {};
  catSums(prevBills, 'expense').forEach((i) => (prevMap[i.name] = i.value));
  const top = items.slice(0, 8);
  return `
  <section class="dc">
    <div class="dc-head"><div class="dc-title">钱花在哪</div><div class="dc-sub">较上一周期</div></div>
    <div class="dc-rank">
      ${top.length ? top.map((i) => {
        const pv = prevMap[i.name] || 0;
        const d = pv ? ((i.value - pv) / pv) * 100 : null;
        const cls = d === null ? '' : d >= 0 ? 'up' : 'down';
        return `<div class="rk-row" data-go="stats">
          <div class="rk-top">
            <span class="rk-nm">${i.icon} ${i.name}</span>
            <span class="rk-v">${yuan(i.value)}${d === null ? '' : `<em class="${cls}">${d >= 0 ? '↑' : '↓'}${Math.abs(d).toFixed(0)}%</em>`}</span>
          </div>
          <div class="rk-bar"><i style="width:${total ? Math.max(2, (i.value / total) * 100) : 0}%;background:${i.color}"></i></div>
        </div>`;
      }).join('') : '<div class="dc-empty">本区间暂无支出</div>'}
    </div>
  </section>`;
}

function catTrendCard(months, bills) {
  const items = catSums(bills, 'expense').slice(0, 3);
  return `
  <section class="dc">
    <div class="dc-head"><div class="dc-title">分类趋势</div><div class="dc-sub">支出 Top 3</div></div>
    <div class="dc-chart"><canvas class="chart" id="dash-cat"></canvas></div>
    <div class="dc-legend">
      ${items.map((i) => `<div class="lg-row"><i style="background:${i.color}"></i><span>${i.icon} ${i.name}</span><b>${yuan(i.value)}</b></div>`).join('')
        || '<div class="dc-empty">本区间暂无支出</div>'}
    </div>
  </section>`;
}

function overviewCard(months, bills) {
  const exp = bills.filter((b) => b.type === 'expense');
  const inc = bills.filter((b) => b.type === 'income');
  const total = exp.reduce((s, b) => s + b.amount, 0);
  const days = new Set(exp.map((b) => b.date)).size || 1;
  const max = exp.reduce((mx, b) => (b.amount > mx.amount ? b : mx), { amount: 0, note: '' });
  const avg = total / days;
  return `
  <section class="dc">
    <div class="dc-head"><div class="dc-title">收支概览</div><div class="dc-sub">${months.length - 1 || 1} 个月</div></div>
    <div class="dc-grid4">
      <div class="g4"><span>支出笔数</span><b>${exp.length}</b></div>
      <div class="g4"><span>收入笔数</span><b>${inc.length}</b></div>
      <div class="g4"><span>日均支出</span><b>${yuan(avg)}</b></div>
      <div class="g4"><span>有支出天数</span><b>${days}</b></div>
      <div class="g4 wide"><span>最大单笔支出</span><b>${yuan(max.amount)}</b><em>${max.note || (catById(max.categoryId)?.name || '')}</em></div>
      <div class="g4 wide"><span>平均单笔</span><b>${yuan(exp.length ? total / exp.length : 0)}</b><em>支出</em></div>
    </div>
  </section>`;
}

function accountCard() {
  const list = S().accounts.filter((a) => !a.hidden && !a.archived)
    .sort((a, b) => Math.abs(b.balance) - Math.abs(a.balance));
  const max = Math.max(...list.map((a) => Math.abs(a.balance)), 1);
  return `
  <section class="dc">
    <div class="dc-head"><div class="dc-title">账户余额</div><div class="dc-sub">${list.length} 个账户</div></div>
    <div class="dc-acc">
      ${list.length ? list.map((a) => {
        const debt = a.type === 'credit';
        const w = (Math.abs(a.balance) / max) * 100;
        return `<div class="ac-row" data-acc="${a.id}">
          <span class="ac-ic" style="background:${a.color}22">${a.icon || '💳'}</span>
          <div class="ac-main">
            <div class="ac-nm">${a.name}${a.includeNet === false ? '<em>不计净资产</em>' : ''}</div>
            <div class="ac-bar"><i style="width:${Math.max(3, w)}%;background:${debt ? '#ff453a' : a.color || '#0a84ff'}"></i></div>
          </div>
          <b class="${debt ? 'down' : ''}">${debt ? '-' : ''}${yuan(Math.abs(a.balance))}</b>
        </div>`;
      }).join('') : '<div class="dc-empty">暂无账户</div>'}
    </div>
  </section>`;
}

function budgetCard() {
  const ym = curYM();
  const list = S().budgets || [];
  if (!list.length) return '';
  const exp = monthSum(curBook().id, ym, 'expense');
  const rows = list.map((b) => {
    const used = b.scope === 'category'
      ? bookBills(curBook().id, ym).filter((x) => x.type === 'expense' && x.categoryId === b.categoryId).reduce((s, x) => s + x.amount, 0)
      : exp;
    const pct = b.amount ? Math.min(100, (used / b.amount) * 100) : 0;
    const over = used > b.amount;
    const nm = b.scope === 'category' ? (catById(b.categoryId)?.name || '分类') : '总预算';
    return `<div class="bd-row" data-go="budget">
      <div class="rk-top"><span class="rk-nm">${nm}</span><span class="rk-v">${yuan(used)} / ${yuan(b.amount)}</span></div>
      <div class="rk-bar"><i style="width:${pct}%;background:${over ? '#ff453a' : '#30d158'}"></i></div>
    </div>`;
  }).join('');
  return `
  <section class="dc">
    <div class="dc-head"><div class="dc-title">预算进度</div><div class="dc-sub">${ymLabel(ym)}</div></div>
    <div class="dc-rank">${rows}</div>
  </section>`;
}

function saveCard() {
  const list = (S().savings || []).filter((p) => !p.archived);
  if (!list.length) return '';
  return `
  <section class="dc">
    <div class="dc-head"><div class="dc-title">存钱计划</div><div class="dc-sub">${list.length} 个</div></div>
    <div class="dc-rank">
      ${list.slice(0, 5).map((p) => {
        const done = (p.records || []).reduce((s, r) => s + r.amount, 0);
        const pct = p.target ? Math.min(100, (done / p.target) * 100) : 0;
        return `<div class="bd-row" data-go="save">
          <div class="rk-top"><span class="rk-nm">${p.icon || '🎯'} ${p.name}</span><span class="rk-v">${yuan(done)} / ${yuan(p.target)}</span></div>
          <div class="rk-bar"><i style="width:${pct}%;background:#ffd60a"></i></div>
        </div>`;
      }).join('')}
    </div>
  </section>`;
}

function recentCard() {
  const list = bookBills(curBook().id).slice(0, 10);
  return `
  <section class="dc">
    <div class="dc-head"><div class="dc-title">最近账单</div><button class="dc-more" data-act="allbills">查看全部 ${Icons.chevR.replace('<svg', '<svg style="width:12px;height:12px"')}</button></div>
    <div class="dc-bills">
      ${list.length ? list.map(rowHTML).join('') : '<div class="dc-empty">还没有账单，点左上角「记一笔」开始</div>'}
    </div>
  </section>`;
}

function rowHTML(b) {
  const cat = catById(b.categoryId);
  const acc = accById(b.accountId);
  const isT = b.type === 'transfer';
  const color = isT ? '#0a84ff22' : b.type === 'income' ? '#30d15822' : (cat?.color || '#ff9f0a') + '22';
  return `<div class="dj-row" data-bill="${b.id}">
    <span class="dj-ic" style="background:${color}">${isT ? Icons.swap : (cat?.icon || '🧾')}</span>
    <div class="dj-main">
      <div class="dj-cat">${isT ? '转账' : (cat?.name || '其他')}</div>
      <div class="dj-note">${b.note || acc?.name || ''}</div>
    </div>
    <div class="dj-right">
      <div class="dj-amt ${b.type === 'income' ? 'up' : isT ? '' : 'down'}">${b.type === 'income' ? '+' : isT ? '' : '-'}${plain(b.amount)}</div>
      <div class="dj-date">${b.date.slice(5)}</div>
    </div>
  </div>`;
}

// ---------- 入口 ----------
export async function renderDashboard() {
  const months = monthList();
  const bills = billsOf(months);
  return `<div class="dash">
    ${heroCard(months)}
    ${donutCard(bills)}
    ${trendCard(months, bills)}
    ${rankCard(months, bills)}
    ${catTrendCard(months, bills)}
    ${overviewCard(months, bills)}
    ${accountCard()}
    ${budgetCard()}
    ${saveCard()}
    ${recentCard()}
  </div>`;
}

export function mountDashboard(root) {
  const months = monthList();
  const bills = billsOf(months);
  const labels = months.map((m) => mnum(m) + '月');

  // 净资产走势
  const c1 = root.querySelector('#dash-net');
  if (c1) line(c1, netSeries(months), labels, {
    height: 220, color: '#ffd60a', fill: true, padL: 52,
    fmt: (v) => (Math.abs(v) >= 10000 ? (v / 10000).toFixed(1) + 'w' : Math.abs(v) >= 1000 ? (v / 1000).toFixed(1) + 'k' : v.toFixed(0)),
  });

  // 支出构成
  const c2 = root.querySelector('#dash-donut');
  if (c2) {
    const items = catSums(bills, 'expense').slice(0, 6);
    const total = items.reduce((s, i) => s + i.value, 0);
    donut(c2, items, '总支出', hide() ? '****' : '¥' + fmtMoney(total));
  }

  // 收支趋势
  const c3 = root.querySelector('#dash-flow');
  if (c3) {
    const f = flowByMonth(months, bills);
    dualBars(c3, f.map((x) => x.exp), f.map((x) => x.inc), labels, { height: 190 });
  }

  // 分类趋势
  const c4 = root.querySelector('#dash-cat');
  if (c4) {
    const top = catSums(bills, 'expense').slice(0, 3);
    multiLine(c4, top.map((t) => ({
      name: t.name, color: t.color,
      values: months.map((ym) => bills.filter((b) => b.type === 'expense' && b.date.startsWith(ym) && (
        catById(b.categoryId)?.id === t.id ||
        (() => { const c = catById(b.categoryId); const all = [...S().categories.expense, ...S().categories.income]; return (all.find((p) => p.children?.some((x) => x.id === c?.id)) || c)?.id === t.id; })()
      )).reduce((s, b) => s + b.amount, 0)),
    })), labels, { height: 170 });
  }

  // 交互
  root.querySelectorAll('.dc-seg [data-rg]').forEach((b) => b.addEventListener('click', () => {
    dash.range = b.dataset.rg;
    go('home');
  }));
  root.querySelector('[data-act="eye"]')?.addEventListener('click', () => {
    S().settings.hideAmount = !hide();
    import('./store.js').then((m) => { m.save(); go('home'); });
  });
  root.querySelectorAll('[data-acc]').forEach((el) =>
    el.addEventListener('click', () => go('assetdetail', { id: el.dataset.acc })));
  root.querySelectorAll('[data-bill]').forEach((el) =>
    el.addEventListener('click', () => go('detail', { id: el.dataset.bill })));
  root.querySelector('[data-act="allbills"]')?.addEventListener('click', () => go('search', { kw: '' }));
  const kw = root.querySelector('#dash-kw');
  let t = null;
  kw?.addEventListener('input', (e) => {
    dash.kw = e.target.value.trim();
    clearTimeout(t);
    t = setTimeout(() => go('search', { kw: dash.kw }), 600);
  });
  onCleanup(() => clearTimeout(t));
}
