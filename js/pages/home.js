// 账本首页（明细）— 参考实现
import Icons from '../icons.js';
import {
  S, curBook, bookBills, monthSum, carryOver, fmtMoney, ymLabel, shiftMonth,
  catById, accById, monthOf, deleteBill, today,
} from '../store.js';
import { esc } from '../util.js';
import { go, onCleanup, UI, isDesktop } from '../app.js';
import { renderDashboard, mountDashboard } from '../dashboard.js';

let state = { ym: null, kw: '' };
const now = () => state.ym || monthOf(today());

function summaryCard(bills) {
  const ym = now();
  const exp = monthSum(curBook().id, ym, 'expense');
  const inc = monthSum(curBook().id, ym, 'income');
  const carry = carryOver(curBook().id, ym);
  const balance = carry + inc - exp;
  const hide = S().settings.hideAmount;
  return `
  <div class="summary-card">
    <div class="sum-main-label"><span class="badge-ic">💸</span>总支出 ⇆</div>
    <div class="sum-amount">${hide ? '****' : '¥' + fmtMoney(exp)}</div>
    <div class="sum-sub">
      <span>总收入<b>${hide ? '****' : '¥' + fmtMoney(inc)}</b></span>
      <span>月结余<b>${hide ? '****' : '¥' + fmtMoney(balance)}</b></span>
    </div>
    <div class="sum-dots"><i class="on"></i><i></i><i></i></div>
  </div>`;
}

function billList(bills) {
  if (!bills.length) return `<div class="empty-tip">本月暂无数据</div>`;
  const groups = {};
  bills.forEach((b) => (groups[b.date] = groups[b.date] || []).push(b));
  const days = Object.keys(groups).sort().reverse();
  return days.map((d) => {
    const list = groups[d];
    const dExp = list.filter((b) => b.type === 'expense').reduce((s, b) => s + b.amount, 0);
    const dInc = list.filter((b) => b.type === 'income').reduce((s, b) => s + b.amount, 0);
    const wd = '日一二三四五六'[new Date(d.replace(/-/g, '/')).getDay()];
    const [, m, dd] = d.split('-');
    return `<div class="day-group">
      <div class="day-head"><b style="color:var(--text)">${+m}月${+dd}日</b><span>星期${wd}</span>
        <span class="sum">${dInc ? `<span style="color:var(--green)">收入 ¥${fmtMoney(dInc)}</span>　` : ''}${dExp ? `支出 ¥${fmtMoney(dExp)}` : ''}</span>
      </div>
      ${list.map(rowHTML).join('')}
    </div>`;
  }).join('');
}

export function rowHTML(b) {
  const cat = catById(b.categoryId);
  const acc = accById(b.accountId);
  const acc2 = b.type === 'transfer' ? accById(b.toAccountId) : null;
  const isTransfer = b.type === 'transfer';
  const color = isTransfer ? '#0a84ff22' : b.type === 'income' ? '#30d15822' : (cat?.color || '#ff9f0a') + '22';
  const amtCls = b.type === 'income' ? 'income' : isTransfer ? 'transfer' : 'expense';
  const sign = b.type === 'income' ? '+' : '';
  const iconHTML = isTransfer
    ? `<span style="color:var(--blue);display:flex;width:19px;height:19px">${Icons.swap}</span>`
    : (cat?.icon || '🧾');
  // 备注缺失时补一个空 div，保证桌面表格化后各行列位对齐
  return `<div class="bill-row" data-bill="${b.id}">
    <div class="bill-ic" style="background:${color}">${iconHTML}</div>
    <div class="bill-main">
      <div class="bill-cat">${isTransfer ? '转账' : (cat?.name || '其他')}${b.claim === 'pending' ? '<span class="tag-mini">待报销</span>' : ''}${b.recurringId ? '<span class="tag-mini">周期</span>' : ''}</div>
      <div class="bill-note">${b.note || ''}</div>
    </div>
    <div class="bill-actions">
      <button class="bill-act" data-edit="${b.id}" title="编辑" aria-label="编辑">${Icons.edit}</button>
      <button class="bill-act del" data-del="${b.id}" title="删除" aria-label="删除">${Icons.trash}</button>
    </div>
    <div class="bill-right" style="text-align:right">
      <div class="bill-amt ${amtCls}">${sign}¥${fmtMoney(b.amount)}</div>
      ${b.type === 'transfer' ? `<div class="bill-note">${acc?.name || ''} → ${acc2?.name || ''}</div>` : `<div class="bill-note">${acc?.name || ''}</div>`}
    </div>
  </div>`;
}

// 超宽屏（≥1600px）第三栏：把右侧剩余面积换成信息，而不是留白
function insightCard(bills) {
  const hide = S().settings.hideAmount;
  const m = (n) => (hide ? '****' : '¥' + fmtMoney(Math.round(n * 100) / 100));
  const exp = bills.filter((b) => b.type === 'expense');
  const total = exp.reduce((s, b) => s + b.amount, 0);
  const days = new Set(exp.map((b) => b.date)).size || 1;
  const max = exp.reduce((mx, b) => (b.amount > mx.amount ? b : mx), { amount: 0 });
  const byCat = {};
  exp.forEach((b) => { byCat[b.categoryId] = (byCat[b.categoryId] || 0) + b.amount; });
  const top = Object.entries(byCat).sort((a, b) => b[1] - a[1]).slice(0, 5);
  return `<aside class="hp-insight">
    <div class="ins-card">
      <div class="ins-title">本月概览</div>
      <div class="ins-row"><span>支出笔数</span><b>${exp.length}</b></div>
      <div class="ins-row"><span>有支出天数</span><b>${days}</b></div>
      <div class="ins-row"><span>日均支出</span><b>${m(total / days)}</b></div>
      <div class="ins-row"><span>最大单笔</span><b>${m(max.amount)}</b></div>
    </div>
    <div class="ins-card">
      <div class="ins-title">支出 Top 5</div>
      ${top.length ? top.map(([cid, v]) => {
        const c = catById(cid);
        const pct = total ? Math.round((v / total) * 100) : 0;
        return `<div class="ins-bar-row">
          <div class="ins-bar-top"><span>${c?.icon || '🧾'} ${c?.name || '其他'}</span><b>${m(v)}</b></div>
          <div class="ins-bar"><i style="width:${pct}%;background:${c?.color || '#ff9f0a'}"></i></div>
        </div>`;
      }).join('') : '<div class="ins-empty">本月暂无支出</div>'}
    </div>
  </aside>`;
}

export default {
  header: 'large',
  fab: true,
  title: () => (isDesktop() ? '总览' : curBook().name),
  // 桌面已有侧栏账本切换，导航栏左按钮去掉
  get navLeft() {
    return isDesktop() ? '' : `<button class="nb-btn" data-act="books">${Icons.swap}</button>`;
  },
  // 桌面网页版（≥1024px）：整页换成「总览仪表盘」，手机端保持原有单列流水
  async render() {
    if (isDesktop()) return renderDashboard();
    const ym = now();
    const bills = bookBills(undefined, ym).filter((b) =>
      !state.kw || (b.note || '').includes(state.kw) || (catById(b.categoryId)?.name || '').includes(state.kw));
    // page-home / hp-left / hp-right：桌面下自动变「左汇总 + 右流水」双栏，手机端仍为单列顺序流
    return `
      <div class="page-home">
        <div class="hp-left">
          <div class="searchbar">${Icons.search}<input id="home-kw" placeholder="输入关键词" value="${esc(state.kw)}"></div>
          <div class="month-row">
            <span class="month-label">${ymLabel(ym)}</span>
            <button class="month-nav" data-m="-1">${Icons.chevL}</button>
            <button class="month-nav" data-m="1" ${ym >= monthOf(today()) ? 'disabled' : ''}>${Icons.chevR}</button>
            <span class="month-spacer"></span>
            <button class="pill-btn" data-go="calendar">${Icons.calendar.replace('<svg', '<svg style="width:14px;height:14px"')} 收支日历</button>
          </div>
          ${summaryCard(bills)}
          <div style="height:8px"></div>
        </div>
        <div class="hp-right">${billList(bills)}</div>
        ${insightCard(bills)}
      </div>`;
  },
  mount(root) {
    if (isDesktop()) return mountDashboard(root);
    // FAB 固定定位版本由 app.js 注入；这里绑定交互
    root.querySelector('#home-kw')?.addEventListener('input', (e) => {
      state.kw = e.target.value.trim();
      clearTimeout(state._t);
      state._t = setTimeout(() => go('search', { kw: state.kw }), 600);
    });
    root.querySelectorAll('.month-nav[data-m]').forEach((b) => b.addEventListener('click', () => {
      state.ym = shiftMonth(now(), +b.dataset.m);
      go('home');
    }));
    onCleanup(() => { clearTimeout(state._t); });
    root.querySelectorAll('[data-bill]').forEach((r) => {
      r.addEventListener('click', () => go('detail', { id: r.dataset.bill }));
      r.addEventListener('contextmenu', (e) => { e.preventDefault(); quickDelete(r.dataset.bill); });
      let timer = null;
      r.addEventListener('touchstart', () => { timer = setTimeout(() => quickDelete(r.dataset.bill), 600); });
      r.addEventListener('touchend', () => clearTimeout(timer));
    });
    // 顶部左按钮：切换账本
    document.querySelector('#navbar [data-act="books"]')?.addEventListener('click', async () => {
      const s = S();
      const pick = await UI.sheet('切换账本', [
        ...s.books.filter((b) => !b.archived).map((b) => ({
          label: b.name, icon: b.icon, value: b.id === s.currentBookId ? '当前' : '',
          onClick: () => { s.currentBookId = b.id; },
        })),
        { label: '管理账本', icon: '⚙️', onClick: () => go('books') },
      ]);
      pick?.onClick?.();
      if (pick?.onClick) { import('../store.js').then((st) => { st.save(); go('home'); }); }
    });
  },
};

function quickDelete(id) {
  UI.confirm('删除这笔账单？', '删除').then((ok) => {
    if (ok) { deleteBill(id); go('home'); }
  });
}
