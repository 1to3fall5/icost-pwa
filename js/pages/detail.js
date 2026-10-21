// 账单详情页
import Icons from '../icons.js';
import {
  S, accById, billById, addBill, deleteBill, fmtMoney, save, uid,
} from '../store.js';
import { esc } from '../util.js';
import { go, back, UI } from '../app.js';

const TYPE = { expense: '支出', income: '收入', transfer: '转账' };
const p2 = (n) => String(n).padStart(2, '0');

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
}
function fmtTs(ts) {
  if (!ts) return '—';
  const d = new Date(ts);
  return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())} ${p2(d.getHours())}:${p2(d.getMinutes())}`;
}
// 分类信息（含二级）
function catInfo(id) {
  const s = S();
  for (const t of ['expense', 'income']) {
    for (const p of s.categories[t] || []) {
      if (p.id === id) return { icon: p.icon, color: p.color, name: p.name, parent: '' };
      const c = (p.children || []).find((x) => x.id === id);
      if (c) return { icon: p.icon, color: p.color, name: c.name, parent: p.name };
    }
  }
  return null;
}
function claimOf(id) { return S().claims.find((c) => c.billId === id); }
function claimState(b) {
  const c = claimOf(b.id);
  return c?.status || (b.claim === 'pending' ? 'pending' : b.claim === 'done' ? 'done' : 'none');
}
function claimBadge(state) {
  if (state === 'pending') return `<span class="tp-badge pending">待报销</span>`;
  if (state === 'done') return `<span class="tp-badge done">已报销</span>`;
  return `<span class="tp-badge none">未关联</span>`;
}

const mod = {
  title: '账单详情',
  header: 'sub',
  async render(params) {
    const b = billById(params.id);
    if (!b) return `<div class="empty-tip">账单不存在或已删除</div>`;

    const cat = catInfo(b.categoryId);
    const icon = b.type === 'transfer' ? '🔄' : (cat?.icon || '🧾');
    const color = b.type === 'transfer' ? '#0a84ff' : (cat?.color || '#98989f');
    const amtColor = b.type === 'income' ? 'var(--green)' : b.type === 'transfer' ? 'var(--text2)' : 'var(--text)';
    const sign = b.type === 'income' ? '+' : '';
    const acc = accById(b.accountId);
    const acc2 = b.type === 'transfer' ? accById(b.toAccountId) : null;
    const cs = claimState(b);
    const tags = (b.tags || []).filter(Boolean);

    const catText = b.type === 'transfer' ? '—'
      : cat ? (cat.parent ? `${esc(cat.parent)} › ${esc(cat.name)}` : esc(cat.name)) : '未分类';

    const accRows = b.type === 'transfer'
      ? `<div class="cell kv-cell"><span class="k">转出账户</span><span class="v">${esc(acc?.name || '—')}</span></div>
         <div class="cell kv-cell"><span class="k">转入账户</span><span class="v">${esc(acc2?.name || '—')}</span></div>`
      : `<div class="cell kv-cell"><span class="k">账户</span><span class="v">${esc(acc?.name || '—')}</span></div>`;

    return `
      <div class="detail-hero">
        <div class="ic" style="background:color-mix(in srgb, ${color} 22%, #1c1c1e)">${icon}</div>
        <div class="amt" style="color:${amtColor}">${sign}¥${fmtMoney(b.amount)}</div>
        <div style="font-size:13px;color:var(--text2);margin-top:6px">${TYPE[b.type] || '支出'}</div>
      </div>

      <div class="cell-group">
        <div class="cell kv-cell"><span class="k">分类</span><span class="v">${catText}</span></div>
        ${accRows}
        <div class="cell kv-cell"><span class="k">日期</span><span class="v dt-mono">${b.date}${b.time ? ' ' + b.time : ''}</span></div>
        <div class="cell kv-cell"><span class="k">备注</span><span class="v">${b.note ? esc(b.note) : '无'}</span></div>
        <div class="cell kv-cell"><span class="k">标签</span>${tags.length
          ? `<span class="dt-tags">${tags.map((t) => `<span class="chip">${esc(t)}</span>`).join('')}</span>`
          : `<span class="v" style="color:var(--text3)">无</span>`}</div>
        <div class="cell kv-cell" data-act="claim">
          <span class="k">报销</span><span class="v">${claimBadge(cs)}</span>
          <span class="arrow">${Icons.chevR}</span>
        </div>
        <div class="cell kv-cell"><span class="k">记录时间</span><span class="v dt-mono">${fmtTs(b.created)}</span></div>
      </div>

      <div class="cell-group">
        <div class="cell" data-act="edit">
          <span class="ci" style="background:rgba(10,132,255,.18)">✏️</span>
          <span class="cl cell-title">编辑</span><span class="arrow">${Icons.chevR}</span>
        </div>
        <div class="cell" data-act="copy">
          <span class="ci" style="background:rgba(48,209,88,.18)">📋</span>
          <span class="cl cell-title">再记一笔</span><span class="arrow">${Icons.chevR}</span>
        </div>
        <div class="cell" data-act="tpl">
          <span class="ci" style="background:rgba(255,214,10,.18)">📌</span>
          <span class="cl cell-title">创建模板</span><span class="arrow">${Icons.chevR}</span>
        </div>
        <div class="cell" data-act="del">
          <span class="ci" style="background:rgba(255,69,58,.18)">🗑️</span>
          <span class="cl cell-title dt-danger">删除账单</span>
        </div>
      </div>
      <div style="height:10px"></div>`;
  },

  mount(root, params) { bind(root, params); },
};

function bind(root, params) {
  const id = params.id;
  const acts = {
    edit: () => go('record', { edit: id }),
    copy: () => {
      const b = billById(id);
      if (!b) return;
      addBill({
        type: b.type,
        amount: b.amount,
        categoryId: b.categoryId,
        accountId: b.accountId,
        toAccountId: b.type === 'transfer' ? b.toAccountId : undefined,
        date: todayStr(),
        note: b.note || '',
        tags: [...(b.tags || [])],
      });
      UI.toast('已复制一笔');
    },
    tpl: () => {
      const b = billById(id);
      if (!b) return;
      S().templates.push({
        id: uid(),
        type: b.type,
        amount: b.amount,
        categoryId: b.categoryId,
        accountId: b.accountId,
        toAccountId: b.toAccountId || '',
        note: b.note || '',
        tags: [...(b.tags || [])],
        created: Date.now(),
      });
      save();
      UI.toast('已创建模板');
    },
    del: async () => {
      const ok = await UI.confirm('删除这笔账单？', '删除');
      if (!ok) return;
      deleteBill(id);
      UI.toast('已删除');
      back();
    },
    claim: () => onClaim(root, params),
  };
  root.querySelectorAll('[data-act]').forEach((el) => {
    const fn = acts[el.dataset.act];
    if (fn) el.addEventListener('click', () => fn());
  });
}

async function onClaim(root, params) {
  const b = billById(params.id);
  if (!b) return;
  const state = claimState(b);
  const opts = [];
  if (state !== 'pending') {
    opts.push({ label: '标记为待报销', icon: '🕒', color: 'rgba(255,214,10,.18)' });
  }
  if (state !== 'none') {
    opts.push({ label: '取消报销标记', icon: '↩️', color: 'rgba(255,69,58,.18)' });
  }
  if (state === 'pending') {
    opts.push({ label: '前往报销管理', icon: '🧾', color: 'rgba(10,132,255,.18)' });
  }
  const pick = await UI.sheet('报销状态', opts);
  if (!pick) return;
  if (pick.label === '前往报销管理') return go('claim');

  if (pick.label === '标记为待报销') {
    b.claim = 'pending';
    const c = claimOf(b.id);
    if (c) { c.amount = b.amount; c.status = 'pending'; c.doneTime = undefined; }
    else S().claims.push({ billId: b.id, amount: b.amount, status: 'pending' });
    save();
    UI.toast('已标记为待报销');
  } else {
    S().claims = S().claims.filter((c) => c.billId !== b.id);
    b.claim = '';
    save();
    UI.toast('已取消报销标记');
  }
  refresh(root, params);
}

async function refresh(root, params) {
  root.innerHTML = await mod.render(params);
  bind(root, params);
  root.querySelectorAll('[data-go]').forEach((b) => b.addEventListener('click', () => go(b.dataset.go)));
}

export default mod;
