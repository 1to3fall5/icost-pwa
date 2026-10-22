// 预算管理：总预算（周/月/年）+ 分类预算
import { S, save, cats, uid, fmtMoney, addTombstone } from '../store.js';
import { esc } from '../util.js';
import { UI } from '../app.js';

const pad = (n) => String(n).padStart(2, '0');
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

const PERIODS = [['week', '周'], ['month', '月'], ['year', '年']];
const PERIOD_LABEL = { week: '本周', month: '本月', year: '本年' };

// 首次渲染时再从 settings 读取（模块加载时 store 可能尚未 load）
let period = null;

// 当期日期区间（账单 date 为 'YYYY-MM-DD'，字符串比较即可）
function range(p = period) {
  const n = new Date();
  if (p === 'week') {
    const ws = S().settings.weekStart ?? 1;
    const off = (n.getDay() - ws + 7) % 7;
    const s = new Date(n); s.setDate(n.getDate() - off);
    const e = new Date(s); e.setDate(s.getDate() + 6);
    return [ymd(s), ymd(e)];
  }
  if (p === 'year') return [`${n.getFullYear()}-01-01`, `${n.getFullYear()}-12-31`];
  return [`${n.getFullYear()}-${pad(n.getMonth() + 1)}-01`, `${n.getFullYear()}-${pad(n.getMonth() + 1)}-31`];
}

function spentOf(categoryId, p = period) {
  const [s, e] = range(p);
  return S().bills.filter((b) => {
    if (b.type !== 'expense' || b.bookId !== S().currentBookId) return false;
    if (b.date < s || b.date > e) return false;
    if (!categoryId) return true;
    const c = cats('expense').find((x) => x.id === categoryId);
    if (!c) return b.categoryId === categoryId;
    return b.categoryId === c.id || c.children.some((x) => x.id === b.categoryId);
  }).reduce((sum, b) => sum + b.amount, 0);
}

const money = (v) => (S().settings.hideAmount ? '****' : '¥' + fmtMoney(v));

// 进度条 + 剩余/超支
function progressHTML(b, used) {
  const ratio = b.amount > 0 ? used / b.amount : 0;
  const pct = Math.min(100, Math.round(ratio * 100));
  const cls = ratio > 1 ? 'over' : ratio > 0.8 ? 'warn' : '';
  const left = b.amount - used;
  return `<div class="bg-bar"><i class="${cls}" style="width:${pct}%"></i></div>
    <div class="bg-meta">
      <span>${Math.round(ratio * 100)}% 已使用</span>
      <span>${left >= 0 ? `剩余 ${money(left)}` : `超支 ${money(-left)}`}</span>
    </div>`;
}

function cardHTML(b, name, icon, color) {
  const used = spentOf(b.categoryId, b.period);
  return `<div class="bg-card" data-budget="${b.id}">
    <div class="bg-row1">
      <span class="bg-ic" style="background:${color}22">${icon}</span>
      <span class="bg-nm">${esc(name)}<span class="bg-sub">${PERIOD_LABEL[b.period] || b.period}已用 ${money(used)}</span></span>
      <span class="bg-amt">${money(b.amount)}</span>
    </div>
    ${progressHTML(b, used)}
  </div>`;
}

function bodyHTML() {
  const st = S();
  const total = st.budgets.find((b) => b.scope === 'total' && b.period === period);
  const list = st.budgets.filter((b) => b.scope === 'category' && b.period === period);
  const totalInner = total
    ? progressHTML(total, spentOf(null, total.period))
    : `<div class="st2-add" data-act="settotal">+ 设置${PERIOD_LABEL[period]}总预算</div>`;
  return `
    <div class="bg-card">
      <div class="bg-row1">
        <span class="bg-ic" style="background:rgba(10,132,255,.16)">🎯</span>
        <span class="bg-nm">总预算<span class="bg-sub">${PERIOD_LABEL[period]}支出上限</span></span>
        ${total ? `<span class="bg-amt">${money(total.amount)}</span>` : ''}
      </div>
      ${totalInner}
    </div>
    <div class="sec-title">分类预算 · ${list.length} 个</div>
    ${list.length
      ? list.map((b) => {
        const c = cats('expense').find((x) => x.id === b.categoryId);
        return cardHTML(b, c?.name || '已删除分类', c?.icon || '🧾', c?.color || '#98989f');
      }).join('')
      : '<div class="cg-tip">暂无分类预算，可在下方添加</div>'}
    <div class="st2-add" data-act="addcat">+ 添加分类预算</div>`;
}

async function setTotal() {
  const cur = S().budgets.find((b) => b.scope === 'total' && b.period === period);
  const val = await UI.prompt(`设置${PERIOD_LABEL[period]}总预算`, '请输入金额', cur ? String(cur.amount) : '', 'number');
  if (val === null) return false;
  const amount = parseFloat(val);
  if (!(amount > 0)) { UI.toast('请输入有效金额'); return false; }
  if (cur) cur.amount = amount;
  else S().budgets.push({ id: uid(), scope: 'total', period, amount });
  save();
  UI.toast('已保存预算');
  return true;
}

async function addCatBudget() {
  const opts = cats('expense').map((c) => ({ label: c.name, icon: c.icon, color: c.color, v: c.id }));
  if (!opts.length) { UI.toast('暂无支出分类'); return false; }
  const pick = await UI.sheet('选择分类', opts);
  if (!pick) return false;
  const val = await UI.prompt(`「${pick.label}」${PERIOD_LABEL[period]}预算`, '请输入金额', '', 'number');
  if (val === null) return false;
  const amount = parseFloat(val);
  if (!(amount > 0)) { UI.toast('请输入有效金额'); return false; }
  const exist = S().budgets.find((b) => b.scope === 'category' && b.period === period && b.categoryId === pick.v);
  if (exist) exist.amount = amount;
  else S().budgets.push({ id: uid(), scope: 'category', period, categoryId: pick.v, amount });
  save();
  UI.toast('已保存预算');
  return true;
}

async function editBudget(id) {
  const b = S().budgets.find((x) => x.id === id);
  if (!b) return false;
  const c = cats('expense').find((x) => x.id === b.categoryId);
  const pick = await UI.sheet(c?.name || '总预算', [
    { label: '修改金额', icon: '💰', v: 'amount' },
    { label: '删除预算', icon: '🗑️', color: 'rgba(255,69,58,.18)', v: 'del' },
  ]);
  if (!pick) return false;
  if (pick.v === 'amount') {
    const val = await UI.prompt('修改预算金额', String(b.amount), String(b.amount), 'number');
    if (val === null) return false;
    const amount = parseFloat(val);
    if (!(amount > 0)) { UI.toast('请输入有效金额'); return false; }
    b.amount = amount; save(); UI.toast('已保存');
    return true;
  }
  const ok = await UI.confirm('确认删除该预算？', '删除');
  if (!ok) return false;
  S().budgets.splice(S().budgets.indexOf(b), 1);
  addTombstone('budgets', b.id);
  save(); UI.toast('已删除');
  return true;
}

export default {
  title: '预算管理',
  header: 'sub',
  async render() {
    if (!period) period = S().settings.budgetPeriod || 'month';
    return `
      <div class="seg">
        ${PERIODS.map(([p, nm]) => `<button data-p="${p}" class="${period === p ? 'on' : ''}">${nm}</button>`).join('')}
      </div>
      <div id="bg-body">${bodyHTML()}</div>
      <div class="st2-note">
        <div class="tt">💡 预算说明</div>
        进度超过 80% 显示橙色，超支显示红色。分类预算按一级分类统计（含其二级分类）。
      </div>`;
  },
  mount(root) {
    const repaint = () => {
      const box = root.querySelector('#bg-body');
      if (box) box.innerHTML = bodyHTML();
      bindBody();
    };
    function bindBody() {
      root.querySelectorAll('[data-budget]').forEach((el) => {
        el.addEventListener('click', async () => { if (await editBudget(el.dataset.budget)) repaint(); });
      });
      root.querySelectorAll('[data-act]').forEach((el) => {
        el.addEventListener('click', async () => {
          const act = el.dataset.act;
          if (act === 'settotal' && await setTotal()) repaint();
          if (act === 'addcat' && await addCatBudget()) repaint();
        });
      });
    }
    root.querySelectorAll('[data-p]').forEach((b) => b.addEventListener('click', () => {
      period = b.dataset.p;
      S().settings.budgetPeriod = period;
      save();
      root.querySelectorAll('[data-p]').forEach((x) => x.classList.toggle('on', x.dataset.p === period));
      repaint();
    }));
    bindBody();
  },
};
