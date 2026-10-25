// 存钱 Tab — 模式入口网格 + 我的存钱计划列表
import Icons from '../icons.js';
import { S, save, fmtMoney } from '../store.js';
import { uiMark } from '../uiicon.js';
import { go, UI } from '../app.js';

const todayStr = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const diffDays = (a, b) =>
  Math.round((new Date(b.replace(/-/g, '/')) - new Date(a.replace(/-/g, '/'))) / 86400000);

// ---- 模式元信息（savedetail 复用） ----
export const MODES = {
  fixed: { label: '定额存钱法', badge: 'calendar' },
  flexible: { label: '灵活存钱法', badge: 'droplet' },
  week52: { label: '52周存钱法', badge: '52' },
  day365: { label: '365存钱法', badge: '365' },
};
export const targetOf = (mode) => (mode === 'week52' ? 13780 : mode === 'day365' ? 6679.5 : 0);
export const defaultName = (mode) =>
  ({ fixed: '定额存钱计划', flexible: '灵活存钱计划', week52: '52周存钱挑战', day365: '365天存钱挑战' }[mode] || '存钱计划');

// ---- 计划统计（savedetail 复用） ----
export const savedOf = (p) => (p.records || []).reduce((s, r) => s + r.amount, 0);
export const periodNo = (p) => {
  const d = diffDays(p.startDate, todayStr());
  if (p.mode === 'week52') return Math.min(52, Math.max(1, Math.floor(d / 7) + 1));
  if (p.mode === 'day365') return Math.min(365, Math.max(1, d + 1));
  return 0;
};
export const nextAmount = (p) => {
  if (p.mode === 'fixed') return p.perAmount || 0;
  if (p.mode === 'week52') return periodNo(p) * 10;
  if (p.mode === 'day365') return Math.round(periodNo(p) * 0.1 * 10) / 10; // n*0.1，保留 1 位小数
  return (p.records || []).slice(-1)[0]?.amount || p.perAmount || 0;
};

// ---- 打卡：定额=每期金额；灵活/52周/365天=弹窗输入（后两者给默认值，可改） ----
export async function punch(plan) {
  const suggest = nextAmount(plan);
  let amt;
  if (plan.mode === 'fixed') {
    amt = plan.perAmount;
    if (!amt || amt <= 0) { UI.toast('请先设置每期金额'); return false; }
  } else {
    const no = periodNo(plan);
    const title = plan.mode === 'flexible'
      ? '存入金额'
      : plan.mode === 'week52'
        ? `第 ${no} 周 · 建议存 ¥${fmtMoney(suggest)}`
        : `第 ${no} 天 · 建议存 ¥${fmtMoney(suggest)}`;
    const v = await UI.prompt(title, '输入金额', suggest ? String(suggest) : '', 'number');
    if (v === null) return false;
    amt = parseFloat(v);
    if (!amt || amt <= 0) { UI.toast('请输入有效金额'); return false; }
  }
  (plan.records = plan.records || []).push({ date: todayStr(), amount: amt });
  save();
  UI.toast('打卡成功 ✓');
  return true;
}

// ---- 计划卡片 ----
function planCard(p) {
  const meta = MODES[p.mode] || MODES.fixed;
  const saved = savedOf(p);
  const pct = p.target > 0 ? Math.min(100, Math.round((saved / p.target) * 100)) : 0;
  const done = p.target > 0 && saved >= p.target;
  return `<div class="save-plan card" data-open="${p.id}">
    <div class="row1">
      ${uiMark(meta.badge, 'badge-ic')}
      <div class="nm">${p.name}<span class="sv-tag">${meta.label}</span></div>
      <button class="sv-punch ${done ? 'done' : ''}" data-punch="${p.id}">${done ? '已完成' : '打卡'}</button>
    </div>
    <div class="progress"><i style="width:${pct}%;background:${done ? 'var(--green)' : 'var(--blue)'}"></i></div>
    <div class="meta">
      <span>已存 ¥${fmtMoney(saved)} / 目标 ¥${fmtMoney(p.target)}</span>
      <span>已打卡 ${(p.records || []).length} 次</span>
    </div>
  </div>`;
}

function listHTML() {
  const list = S().savings;
  if (!list.length) return `<div class="empty-tip">暂无数据</div>`;
  return list.map(planCard).join('');
}

const MODE_ARR = ['fixed', 'flexible', 'week52', 'day365'];

export default {
  header: 'large',
  title: '存钱',
  navLeft: ' ', // 留空：存钱页左上角不放按钮
  navRight: `<button class="nb-btn" data-act="nav-more">${Icons.more}</button><button class="nb-btn avatar" data-act="settings">${Icons.avatar}</button>`,
  render() {
    return `
      <div class="mode-grid">
        ${MODE_ARR.map((m) => {
          const meta = MODES[m];
          return `<button class="mode-card" data-mode="${m}">
            ${uiMark(meta.badge, 'badge-ic')}
            <span class="nm">${meta.label}</span>
          </button>`;
        }).join('')}
      </div>
      <div id="sv-list">${listHTML()}</div>`;
  },
  mount(root) {
    root.querySelectorAll('[data-mode]').forEach((b) =>
      b.addEventListener('click', () => go('savedetail', { mode: b.dataset.mode })));
    // 事件委托：打卡 / 进详情（重渲染 innerHTML 后依然有效）
    root.addEventListener('click', async (e) => {
      const punchBtn = e.target.closest('[data-punch]');
      if (punchBtn) {
        e.stopPropagation();
        const p = S().savings.find((x) => x.id === punchBtn.dataset.punch);
        if (p && (await punch(p))) {
          const box = root.querySelector('#sv-list');
          if (box) box.innerHTML = listHTML();
        }
        return;
      }
      const open = e.target.closest('[data-open]');
      if (open) go('savedetail', { id: open.dataset.open });
    });
  },
};
