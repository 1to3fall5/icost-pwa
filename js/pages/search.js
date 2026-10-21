// 搜索：关键词 + 类型/时间/账户/排序筛选，按日分组展示结果
import Icons from '../icons.js';
import { S, curBook, bookBills, catById, accById, fmtMoney, monthOf, pad2 } from '../store.js';
import { esc } from '../util.js';
import { go, onCleanup } from '../app.js';
import { rowHTML } from './home.js';

const TYPES = [
  { v: 'all', t: '全部' }, { v: 'expense', t: '支出' },
  { v: 'income', t: '收入' }, { v: 'transfer', t: '转账' },
];
const TIMES = [{ v: 'all', t: '全部' }, { v: 'month', t: '本月' }, { v: 'year', t: '今年' }];
const SORTS = [{ v: 'time', t: '时间倒序' }, { v: 'amount', t: '金额从大到小' }];

const st = { kw: '', type: 'all', time: 'all', acc: 'all', sort: 'time' };
const view = { root: null };

const todayISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
};
const curYM = () => monthOf(todayISO());

const accList = () => S().accounts.filter((a) => !a.archived);
const accName = (id) => (id === 'all' ? '全部' : (accById(id)?.name || '全部'));
const typeName = (v) => TYPES.find((t) => t.v === v)?.t || '全部';
const timeName = (v) => TIMES.find((t) => t.v === v)?.t || '全部';
const sortName = (v) => SORTS.find((t) => t.v === v)?.t || '时间倒序';

function results() {
  const kw = st.kw.trim();
  let list = bookBills(curBook().id);
  if (st.type !== 'all') list = list.filter((b) => b.type === st.type);
  if (st.time === 'month') list = list.filter((b) => b.date.startsWith(curYM()));
  else if (st.time === 'year') list = list.filter((b) => b.date.slice(0, 4) === curYM().slice(0, 4));
  if (st.acc !== 'all') list = list.filter((b) => b.accountId === st.acc || b.toAccountId === st.acc);
  if (kw) {
    list = list.filter((b) => {
      const cat = catById(b.categoryId);
      const acc = accById(b.accountId);
      return (b.note || '').includes(kw) || (cat?.name || '').includes(kw) || (acc?.name || '').includes(kw);
    });
  }
  if (st.sort === 'amount') list = [...list].sort((a, b) => b.amount - a.amount);
  return list;
}

function groupsHTML(list) {
  if (!list.length) return `<div class="empty-tip">没有找到相关账单</div>`;
  const groups = {};
  list.forEach((b) => (groups[b.date] = groups[b.date] || []).push(b));
  const days = Object.keys(groups).sort().reverse();
  return days.map((d) => {
    const g = groups[d];
    const exp = g.filter((b) => b.type === 'expense').reduce((s, b) => s + b.amount, 0);
    const inc = g.filter((b) => b.type === 'income').reduce((s, b) => s + b.amount, 0);
    const wd = '日一二三四五六'[new Date(d.replace(/-/g, '/')).getDay()];
    return `<div class="day-group">
      <div class="day-head"><b style="color:var(--text)">${+d.slice(5, 7)}月${+d.slice(8, 10)}日</b><span>星期${wd}</span>
        <span class="sum">${inc ? `<span style="color:var(--green)">收入 ¥${fmtMoney(inc)}</span>　` : ''}${exp ? `支出 ¥${fmtMoney(exp)}` : ''}</span>
      </div>
      ${g.map(rowHTML).join('')}
    </div>`;
  }).join('');
}

function chipsHTML() {
  const chip = (f, text, on) => `<button class="chip${on ? ' on' : ''}" data-f="${f}">${text}${Icons.chevD.replace('<svg', '<svg style="width:11px;height:11px"')}</button>`;
  return `<div class="filter-chips">
    ${chip('type', `类型 · ${typeName(st.type)}`, st.type !== 'all')}
    ${chip('time', `时间 · ${timeName(st.time)}`, st.time !== 'all')}
    ${chip('acc', `账户 · ${accName(st.acc)}`, st.acc !== 'all')}
    ${chip('sort', sortName(st.sort), st.sort !== 'time')}
  </div>`;
}

function bodyHTML() {
  const list = results();
  const exp = list.filter((b) => b.type === 'expense').reduce((s, b) => s + b.amount, 0);
  const inc = list.filter((b) => b.type === 'income').reduce((s, b) => s + b.amount, 0);
  return `
  <div class="searchbar">${Icons.search}<input id="se-kw" placeholder="搜索备注 / 分类 / 账户" value="${esc(st.kw)}"></div>
  ${chipsHTML()}
  <div id="se-list">${groupsHTML(list)}</div>
  <div class="se-sum" id="se-sum">共 ${list.length} 笔 · 支出 ¥${fmtMoney(exp)} · 收入 ¥${fmtMoney(inc)}</div>`;
}

// 仅刷新筛选条 + 结果区，避免整页重绘打断输入
function paintList(root) {
  const chips = root.querySelector('.filter-chips');
  if (chips) chips.outerHTML = chipsHTML();
  const list = results();
  const box = root.querySelector('#se-list');
  if (box) box.innerHTML = groupsHTML(list);
  const sum = root.querySelector('#se-sum');
  if (sum) {
    const exp = list.filter((b) => b.type === 'expense').reduce((s, b) => s + b.amount, 0);
    const inc = list.filter((b) => b.type === 'income').reduce((s, b) => s + b.amount, 0);
    sum.textContent = `共 ${list.length} 笔 · 支出 ¥${fmtMoney(exp)} · 收入 ¥${fmtMoney(inc)}`;
  }
  bindList(root);
}

function cycle(arr, cur) {
  const i = arr.findIndex((x) => x.v === cur);
  return arr[(i + 1) % arr.length].v;
}

function bindList(root) {
  root.querySelectorAll('#se-list [data-bill]').forEach((r) =>
    r.addEventListener('click', () => go('detail', { id: r.dataset.bill })));
}

function bindChips(root) {
  root.querySelectorAll('.filter-chips [data-f]').forEach((c) => c.addEventListener('click', () => {
    const f = c.dataset.f;
    if (f === 'type') st.type = cycle(TYPES, st.type);
    else if (f === 'time') st.time = cycle(TIMES, st.time);
    else if (f === 'sort') st.sort = cycle(SORTS, st.sort);
    else if (f === 'acc') {
      const opts = [{ v: 'all' }, ...accList().map((a) => ({ v: a.id }))];
      st.acc = cycle(opts, st.acc);
    }
    paintList(root);
  }));
}

export default {
  header: 'sub',
  title: '搜索',
  render(params = {}) {
    if (params.kw !== undefined) st.kw = params.kw;
    return bodyHTML();
  },
  mount(root) {
    view.root = root;
    const input = root.querySelector('#se-kw');
    input?.focus();
    let timer = null;
    input?.addEventListener('input', (e) => {
      clearTimeout(timer);
      timer = setTimeout(() => { st.kw = e.target.value; paintList(root); }, 300);
    });
    bindChips(root);
    bindList(root);
    onCleanup(() => { clearTimeout(timer); view.root = null; });
  },
};
