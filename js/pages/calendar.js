// 收支日历：月导航 + 日历网格（日支出/收入）+ 选中日账单
import Icons from '../icons.js';
import { curBook, bookBills, fmtMoney, ymLabel, shiftMonth, monthOf, pad2 } from '../store.js';
import { go, onCleanup } from '../app.js';
import { rowHTML } from './home.js';
import { uiMark } from '../uiicon.js';

const st = { ym: null, sel: null };
const view = { root: null, map: {} };

const todayISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
};
const curYM = () => st.ym || monthOf(todayISO());
const WD = ['一', '二', '三', '四', '五', '六', '日'];   // 周起始一

const compact = (n) => {
  const v = Math.abs(n);
  if (v >= 10000) return (v / 10000).toFixed(1).replace(/\.0$/, '') + '万';
  if (v >= 1000) return (v / 1000).toFixed(1).replace(/\.0$/, '') + 'k';
  return String(Math.round(v * 10) / 10);
};

// 按日聚合当月支出/收入
function buildMap() {
  const map = {};
  bookBills(curBook().id, curYM()).forEach((b) => {
    if (b.type !== 'expense' && b.type !== 'income') return;
    const d = map[b.date] || (map[b.date] = { expense: 0, income: 0 });
    d[b.type] += b.amount;
  });
  view.map = map;
  return map;
}

function gridHTML(map) {
  const ym = curYM();
  const [y, m] = ym.split('-').map(Number);
  const offset = (new Date(y, m - 1, 1).getDay() + 6) % 7;
  const days = new Date(y, m, 0).getDate();
  const t = todayISO();
  let out = '';
  for (let i = 0; i < offset; i++) out += `<div class="cal-day blank"></div>`;
  for (let d = 1; d <= days; d++) {
    const k = `${ym}-${pad2(d)}`;
    const v = map[k] || { expense: 0, income: 0 };
    out += `<div class="cal-day${k === t ? ' today' : ''}${k === st.sel ? ' sel' : ''}" data-d="${k}">
      <span class="d">${d}</span>
      ${v.expense ? `<span class="exp">${compact(v.expense)}</span>` : ''}
      ${v.income ? `<span class="inc">${compact(v.income)}</span>` : ''}
    </div>`;
  }
  return out;
}

function listHTML() {
  if (!st.sel) return '';
  const k = st.sel;
  const list = bookBills(curBook().id, curYM()).filter((b) => b.date === k);
  const wd = '日一二三四五六'[new Date(k.replace(/-/g, '/')).getDay()];
  const exp = list.filter((b) => b.type === 'expense').reduce((s, b) => s + b.amount, 0);
  const inc = list.filter((b) => b.type === 'income').reduce((s, b) => s + b.amount, 0);
  return `<div class="card">
    <div class="ca-list-title">
      ${uiMark('calendar', 'badge-ic')}
      ${+k.slice(5, 7)}月${+k.slice(8, 10)}日 星期${wd}
      <span class="st-note" style="margin-left:auto">
        ${inc ? `<span style="color:var(--green)">收 ¥${fmtMoney(inc)}</span>　` : ''}${exp ? `支 ¥${fmtMoney(exp)}` : ''}
      </span>
    </div>
    ${list.length ? list.map(rowHTML).join('') : '<div class="ca-empty">当日暂无账单</div>'}
  </div>`;
}

function bodyHTML() {
  const map = buildMap();
  const exp = Object.values(map).reduce((s, v) => s + v.expense, 0);
  const inc = Object.values(map).reduce((s, v) => s + v.income, 0);
  return `
  <div class="month-row">
    <button class="round-nav" data-m="-1">${Icons.chevL}</button>
    <button class="round-nav" data-m="1">${Icons.chevR}</button>
    <span class="month-label">${ymLabel(curYM())}</span>
    <span class="month-spacer"></span>
  </div>

  <div class="card">
    <div class="ca-sum">
      <div><div class="lb">支出</div><div class="amt" style="color:var(--red)">¥${fmtMoney(exp)}</div></div>
      <div><div class="lb">收入</div><div class="amt" style="color:var(--green)">¥${fmtMoney(inc)}</div></div>
      <div><div class="lb">结余</div><div class="amt">¥${fmtMoney(inc - exp)}</div></div>
    </div>
  </div>

  <div class="card">
    <div class="cal-grid">${WD.map((w) => `<div class="cal-wd">${w}</div>`).join('')}</div>
    <div class="cal-grid" id="ca-grid" style="margin-top:4px">${gridHTML(map)}</div>
  </div>

  <div id="ca-list">${listHTML()}</div>`;
}

function refreshList(root) {
  root.querySelectorAll('#ca-grid .cal-day[data-d]').forEach((el) => {
    el.classList.toggle('sel', el.dataset.d === st.sel);
  });
  const box = root.querySelector('#ca-list');
  if (box) box.innerHTML = listHTML();
  bindRows(root);
}

function bindRows(root) {
  root.querySelectorAll('#ca-list [data-bill]').forEach((r) =>
    r.addEventListener('click', () => go('detail', { id: r.dataset.bill })));
}

function bind(root) {
  root.querySelectorAll('.round-nav[data-m]').forEach((b) => b.addEventListener('click', () => {
    st.ym = shiftMonth(curYM(), +b.dataset.m);
    st.sel = st.sel && st.sel.startsWith(st.ym) ? st.sel : `${st.ym}-01`;
    paint(root);
  }));
  root.querySelectorAll('#ca-grid [data-d]').forEach((el) => el.addEventListener('click', () => {
    st.sel = el.dataset.d;
    refreshList(root);
  }));
  bindRows(root);
}

function paint(root) {
  root.innerHTML = bodyHTML();
  bind(root);
}

export default {
  header: 'sub',
  title: '收支日历',
  render(params = {}) {
    st.ym = params.ym || st.ym || monthOf(todayISO());
    const t = todayISO();
    st.sel = (params.d && params.d.startsWith(st.ym)) ? params.d : (t.startsWith(st.ym) ? t : `${st.ym}-01`);
    return bodyHTML();
  },
  mount(root) {
    view.root = root;
    bind(root);
    onCleanup(() => { view.root = null; });
  },
};
