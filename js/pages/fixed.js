// 固定支出管理：固定项清单 + 关键词自动归集 + 每月可用额度
import Icons from '../icons.js';
import { S, save, fmtMoney, monthOf, today, shiftMonth, ymLabel, catById } from '../store.js';
import { esc } from '../util.js';
import { uiMark } from '../uiicon.js';
import { UI } from '../app.js';
import {
  monthly, monthAmount, activeFixed, addFixed, updateFixed, removeFixed,
  CYCLES, CYCLE_LABEL,
} from '../fixed.js';

let ym = null;                       // 首次渲染时再取（模块加载时 store 可能还没 load）
const cur = () => ym || monthOf(today());

const money = (n) => (S().settings.hideAmount ? '****' : '¥' + fmtMoney(n));

// ---- 汇总卡 ----
function summaryCard() {
  const m = monthly(cur());
  const pct = m.cap > 0 ? Math.min(100, Math.round((m.flex / m.cap) * 100)) : 0;
  const over = m.flex > m.cap;
  return `<div class="fx-sum card">
    <div class="fx-top">
      <div class="fx-main">
        <div class="fx-lb">还能花（${m.capIsDefault ? '未设额度，按可分配' : '按额度'}）</div>
        <div class="fx-amt" style="color:${over ? 'var(--red)' : 'var(--text)'}">${money(m.left)}</div>
        <div class="fx-sub">额度 ${money(m.cap)} · 已花浮动 ${money(m.flex)}</div>
      </div>
      <div class="fx-side">
        <div class="fx-kv"><span>预计可存</span><b>${money(m.expectSave)}</b></div>
        <div class="fx-kv"><span>实际存下</span><b>${money(m.actualSave)}</b></div>
      </div>
    </div>
    <div class="fx-bar"><i class="${over ? 'over' : pct > 80 ? 'warn' : ''}" style="width:${pct}%"></i></div>
    <div class="fx-grid">
      <div class="fx-cell"><span>本月收入</span><b>${money(m.income)}</b></div>
      <div class="fx-cell"><span>固定支出</span><b>${money(m.fixedPlan)}</b></div>
      <div class="fx-cell"><span>可分配</span><b>${money(m.allocatable)}</b></div>
    </div>
  </div>`;
}

// ---- 固定项列表 ----
function itemHTML(it) {
  const f = it.item;
  const cat = catById(f.categoryId);
  const tag = it.state === 'paid' ? '<span class="fx-tag ok">已缴</span>'
    : it.state === 'partial' ? '<span class="fx-tag mid">部分</span>'
      : '<span class="fx-tag no">未缴</span>';
  return `<div class="cell" data-fx="${f.id}">
    ${uiMark(f.active === false ? 'moon' : 'receipt', 'ci')}
    <span class="cl">${esc(f.name)}${cat ? `<span class="cell-sub">${esc(cat.name)} · ${(f.keywords || []).join(' / ') || '未设关键词'}</span>` : `<span class="cell-sub">${(f.keywords || []).join(' / ') || '未设关键词'}</span>`}</span>
    <span class="fx-right">
      <b>${money(it.plan)}</b>
      <span class="fx-cyc">${CYCLE_LABEL[f.cycle] || '每月'}${f.cycle !== 'month' ? ` · 共 ${money(f.amount)}` : ''}</span>
      ${tag}
    </span>
  </div>`;
}

function bodyHTML() {
  const m = monthly(cur());
  const list = activeFixed();
  return `
    <div class="month-row" style="justify-content:space-between">
      <button class="month-nav" data-m="-1">${Icons.chevL}</button>
      <span class="month-label">${ymLabel(cur())}</span>
      <button class="month-nav" data-m="1" ${cur() >= monthOf(today()) ? 'disabled' : ''}>${Icons.chevR}</button>
    </div>
    ${summaryCard()}

    <div class="sec-title">固定支出 · ${list.length} 项</div>
    <div class="cell-group" id="fx-list">
      ${list.length ? m.items.map(itemHTML).join('')
    : '<div class="cg-tip">还没有固定支出，先加一项（如停车费、水电）</div>'}
    </div>
    <div class="st2-add" data-act="new">+ 添加固定支出</div>

    <div class="sec-title">额度</div>
    <div class="cell-group">
      <div class="cell" data-act="cap">
        ${uiMark('target', 'ci')}
        <span class="cl">每月可用额度<span class="cell-sub">${m.capIsDefault ? '未设置 · 当前按可分配自动算' : '已设置'}</span></span>
        <span class="cv">${m.capIsDefault ? '自动' : money(m.cap)}</span>
        <span class="arrow">${Icons.chevR}</span>
      </div>
    </div>

    <div class="st2-note">
      <div class="tt">${uiMark('info-circle', 'badge-ic')}怎么用</div>
      <b>固定支出</b>是每月雷打不动要付的钱：给它配上关键词（如「停车」「电费」），
      导入账单时备注命中的会自动归到该项，并显示「已缴」。<br>
      <b>可分配</b>＝ 本月收入 − 固定支出；<b>每月可用额度</b>是你打算花的上限；
      两者之差就是<b>预计可存</b>。额度不设就默认等于可分配（即预计可存 0）。
    </div>`;
}

async function addItem() {
  const name = await UI.prompt('固定支出名称', '如：停车费、水电燃气、房租', '');
  if (!name) return false;
  const amount = await UI.prompt(`「${name}」金额`, '每月（或每季 / 每年）付多少', '', 'number');
  const val = parseFloat(amount);
  if (!(val > 0)) { UI.toast('请输入有效金额'); return false; }
  const cyc = await UI.sheet('周期', CYCLES.map(([v, t]) => ({ label: t, value: v })));
  if (!cyc) return false;
  const kw = await UI.prompt('归集关键词', '账单备注含这些词就算缴了，多个用空格隔开', name);
  addFixed({
    name,
    amount: val,
    cycle: cyc.value,
    keywords: String(kw || name).split(/[\s,，、]+/).filter(Boolean),
  });
  save();
  UI.toast(`已添加「${name}」`);
  return true;
}

async function editItem(id) {
  const f = (S().fixedCosts || []).find((x) => x.id === id);
  if (!f) return false;
  const pick = await UI.sheet(f.name, [
    { label: '修改名称', icon: 'edit', v: 'name' },
    { label: '修改金额', icon: 'coin', v: 'amount' },
    { label: '修改周期', icon: 'refresh', v: 'cycle' },
    { label: '修改关键词', icon: 'search', v: 'kw' },
    { label: f.active === false ? '重新启用' : '暂时停用', icon: 'moon', v: 'toggle' },
    { label: '删除', icon: 'trash', danger: true, v: 'del' },
  ]);
  if (!pick) return false;
  if (pick.v === 'name') {
    const v = await UI.prompt('修改名称', f.name, f.name);
    if (!v) return false;
    updateFixed(id, { name: v });
  } else if (pick.v === 'amount') {
    const v = await UI.prompt('修改金额', String(f.amount), String(f.amount), 'number');
    if (!(parseFloat(v) > 0)) return false;
    updateFixed(id, { amount: parseFloat(v) });
  } else if (pick.v === 'cycle') {
    const c = await UI.sheet('周期', CYCLES.map(([v2, t]) => ({ label: t, value: v2 })));
    if (!c) return false;
    updateFixed(id, { cycle: c.value });
  } else if (pick.v === 'kw') {
    const v = await UI.prompt('归集关键词', '多个用空格隔开', (f.keywords || []).join(' '));
    updateFixed(id, { keywords: String(v || '').split(/[\s,，、]+/).filter(Boolean) });
  } else if (pick.v === 'toggle') {
    updateFixed(id, { active: f.active === false });
  } else if (pick.v === 'del') {
    if (!(await UI.confirm(`删除固定支出「${f.name}」？（账单不受影响）`, '删除'))) return false;
    removeFixed(id);
    const { addTombstone } = await import('../store.js');
    addTombstone('fixedCosts', id);
  }
  save();
  return true;
}

async function editCap() {
  const cur2 = Number(S().settings.spendCap) || 0;
  const v = await UI.prompt('每月可用额度', '留空或 0 = 按可分配自动算', cur2 ? String(cur2) : '', 'number');
  if (v === null) return false;
  S().settings.spendCap = Math.max(0, parseFloat(v) || 0);
  save();
  UI.toast(S().settings.spendCap ? '额度已设置' : '已改为自动');
  return true;
}

export default {
  title: '固定支出',
  header: 'sub',
  navRight: `<button class="nb-btn" data-act="fx-help">${Icons.help}</button>`,
  async render() {
    if (!ym) ym = monthOf(today());
    return `<div id="fx-body">${bodyHTML()}</div>`;
  },
  mount(root) {
    const repaint = () => {
      const box = root.querySelector('#fx-body');
      if (box) box.innerHTML = bodyHTML();
      bind();
    };
    const refresh = async (changed) => { if (changed) repaint(); };
    function bind() {
      root.querySelectorAll('[data-m]').forEach((b) => b.addEventListener('click', () => {
        ym = shiftMonth(ym, +b.dataset.m);
        repaint();
      }));
      root.querySelectorAll('[data-fx]').forEach((el) => {
        el.addEventListener('click', async () => { refresh(await editItem(el.dataset.fx)); });
      });
      root.querySelector('[data-act="new"]')?.addEventListener('click', async () => {
        refresh(await addItem());
      });
      root.querySelector('[data-act="cap"]')?.addEventListener('click', async () => {
        refresh(await editCap());
      });
    }
    document.querySelector('#navbar [data-act="fx-help"]')?.addEventListener('click', () => {
      UI.toast('固定支出 = 每月必付；可分配 = 收入 − 固定支出；额度 = 你计划花的上限', 3600);
    });
    bind();
  },
};
