// 分类统计详情：月导航 + 支出/收入切换 + 环形图/排行 + 展开分类账单
import Icons from '../icons.js';
import { curBook, bookBills, fmtMoney, ymLabel, shiftMonth, monthOf, pad2 } from '../store.js';
import { donut, rankList } from '../charts.js';
import { go, onCleanup } from '../app.js';
import { rowHTML } from './home.js';
import { topCatOf, catAgg } from './stats.js';

const st = { ym: null, type: 'expense', open: null };
const view = { root: null };

const todayISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
};
const curYM = () => st.ym || monthOf(todayISO());

const monthBills = () => bookBills(curBook().id, curYM());

function billsHTML() {
  if (!st.open) return '';
  const openId = topCatOf(st.open)?.id || st.open;
  const cat = topCatOf(openId);
  const list = monthBills().filter((b) => b.type === st.type && (topCatOf(b.categoryId)?.id || 'other') === openId);
  if (!list.length) {
    return `<div class="st-list"><div class="ca-empty">${cat?.name || '该分类'}本月暂无账单</div></div>`;
  }
  const groups = {};
  list.forEach((b) => (groups[b.date] = groups[b.date] || []).push(b));
  const days = Object.keys(groups).sort().reverse();
  return `<div class="st-list" id="sd-bills">
    ${days.map((d) => {
    const g = groups[d];
    const sum = g.reduce((s, b) => s + b.amount, 0);
    const wd = '日一二三四五六'[new Date(d.replace(/-/g, '/')).getDay()];
    return `<div class="day-group">
        <div class="day-head"><b style="color:var(--text)">${+d.slice(5, 7)}月${+d.slice(8, 10)}日</b><span>星期${wd}</span>
          <span class="sum">${st.type === 'income' ? '收入' : '支出'} ¥${fmtMoney(sum)}</span>
        </div>
        ${g.map(rowHTML).join('')}
      </div>`;
  }).join('')}
  </div>`;
}

function bodyHTML() {
  const items = catAgg(monthBills(), st.type);
  const total = items.reduce((s, i) => s + i.value, 0);
  return `
  <div class="month-row">
    <button class="round-nav" data-m="-1">${Icons.chevL}</button>
    <button class="round-nav" data-m="1"${curYM() >= monthOf(todayISO()) ? ' disabled style="opacity:.4"' : ''}>${Icons.chevR}</button>
    <span class="month-label">${ymLabel(curYM())}</span>
    <span class="month-spacer"></span>
  </div>

  <div class="seg" data-seg="type">
    <button data-v="expense" class="${st.type === 'expense' ? 'on' : ''}">支出</button>
    <button data-v="income" class="${st.type === 'income' ? 'on' : ''}">收入</button>
  </div>

  <div class="card">
    <div class="card-title-row">
      <span class="badge-ic" style="background:#ffd60a22">🗂️</span>
      <span class="card-title">${st.type === 'expense' ? '支出' : '收入'}分类统计</span>
      <span class="st-note">合计 ¥${fmtMoney(total)}</span>
    </div>
    <div class="chart-wrap"><canvas class="chart" id="sd-donut"></canvas></div>
    <div id="sd-rank" class="st-list"></div>
    ${billsHTML()}
  </div>`;
}

function draw() {
  const root = view.root;
  if (!root) return;
  const items = catAgg(monthBills(), st.type);
  const total = items.reduce((s, i) => s + i.value, 0);
  donut(root.querySelector('#sd-donut'), items,
    `${st.type === 'expense' ? '总支出' : '总收入'} ⇆`, `¥${fmtMoney(total)}`);
  const rank = root.querySelector('#sd-rank');
  if (rank) rankList(rank, items, total);
}

function bind() {
  const root = view.root;
  root.querySelectorAll('.round-nav[data-m]').forEach((b) => b.addEventListener('click', () => {
    st.ym = shiftMonth(curYM(), +b.dataset.m);
    paint();
  }));

  root.querySelectorAll('[data-seg="type"] button').forEach((b) => b.addEventListener('click', () => {
    st.type = b.dataset.v;
    root.querySelectorAll('[data-seg="type"] button').forEach((x) => x.classList.toggle('on', x === b));
    paint();
  }));

  root.querySelectorAll('#sd-rank [data-cat]').forEach((r) => r.addEventListener('click', () => {
    st.open = st.open === r.dataset.cat ? null : r.dataset.cat;
    paint();
    if (st.open) root.querySelector('#sd-bills')?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }));

  root.querySelectorAll('[data-bill]').forEach((r) => r.addEventListener('click', () => go('detail', { id: r.dataset.bill })));
}

function paint() {
  if (!view.root) return;
  view.root.innerHTML = bodyHTML();
  draw();
  bind();
}

export default {
  header: 'sub',
  title: '分类统计',
  render(params = {}) {
    st.type = params.type === 'income' ? 'income' : 'expense';
    st.ym = params.ym || st.ym || monthOf(todayISO());
    st.open = params.cat || null;                 // 带 cat 参数直接进入该分类
    return bodyHTML();
  },
  mount(root, params = {}) {
    view.root = root;
    draw();
    bind();
    if (st.open) {
      // 展开后滚动到账单区
      requestAnimationFrame(() => root.querySelector('#sd-bills')?.scrollIntoView({ block: 'start' }));
    }
    const onResize = () => draw();
    window.addEventListener('resize', onResize);
    onCleanup(() => {
      window.removeEventListener('resize', onResize);
      view.root = null;
    });
  },
};
