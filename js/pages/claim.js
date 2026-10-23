// 报销管理
import { S, cats, billById, addBill, fmtMoney, save, clearClaim, upsertClaim } from '../store.js';
import { esc } from '../util.js';
import { catMarkHTML } from '../caticon.js';
import { go, UI } from '../app.js';

const p2 = (n) => String(n).padStart(2, '0');
const todayStr = () => {
  const d = new Date();
  return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
};
const tab = { status: 'pending' };

function catInfo(id) {
  const s = S();
  for (const t of ['expense', 'income']) {
    for (const p of s.categories[t] || []) {
      if (p.id === id) return { icon: p.icon, color: p.color, name: p.name };
      const c = (p.children || []).find((x) => x.id === id);
      if (c) return { icon: p.icon, color: p.color, name: c.name };
    }
  }
  return null;
}
// 报销收入分类
function claimCat() {
  const list = cats('income');
  return list.find((c) => c.name.includes('报销')) || list[0];
}
function sumOf(status) {
  return (S().claims || []).filter((c) => c.status === status).reduce((s, c) => s + (+c.amount || 0), 0);
}

function rowHTML(c) {
  const b = billById(c.billId);
  const cat = b ? catInfo(b.categoryId) : null;
  const mark = catMarkHTML({
    name: cat?.name || '', parent: cat?.parent || '', icon: cat?.icon || '🧾',
    color: color, type: cat?.type, cls: 'badge-ic',
  });
  const color = cat?.color || '#ff9f0a';
  const title = b?.note || cat?.name || '已删除的账单';
  const sub = `${b ? b.date : '—'}${cat?.name ? ' · ' + cat.name : ''}`;
  return `<div class="cj-row" data-claim="${c.billId}">
    ${mark}
    <div class="main">
      <div class="nm">${esc(title)}</div>
      <div class="sub">${esc(sub)}</div>
    </div>
    <div class="amt ${c.status === 'done' ? 'done' : ''}">¥${fmtMoney(c.amount)}</div>
  </div>`;
}

const mod = {
  title: '报销管理',
  header: 'sub',
  async render() {
    const claims = S().claims || [];
    const list = claims.filter((c) => c.status === tab.status);
    const pending = sumOf('pending');
    const done = sumOf('done');
    return `
      <div class="cj-stat">
        <div class="box">
          <div class="lb">待报销</div>
          <div class="amt" style="color:var(--yellow)">¥${fmtMoney(pending)}</div>
        </div>
        <div class="box">
          <div class="lb">已报销</div>
          <div class="amt" style="color:var(--green)">¥${fmtMoney(done)}</div>
        </div>
      </div>
      <div class="seg" id="cj-seg">
        <button data-s="pending" class="${tab.status === 'pending' ? 'on' : ''}">待报销</button>
        <button data-s="done" class="${tab.status === 'done' ? 'on' : ''}">已报销</button>
      </div>
      ${list.length
        ? `<div class="cell-group" style="padding:4px 12px">${list.map(rowHTML).join('')}</div>`
        : `<div class="empty-tip">暂无报销 · 记账时可将账单标记为待报销</div>`}
      <div style="height:10px"></div>`;
  },
  mount(root, params) { bind(root, params); },
};

function bind(root, params) {
  root.querySelectorAll('#cj-seg [data-s]').forEach((b) => b.addEventListener('click', () => {
    tab.status = b.dataset.s;
    refresh(root, params);
  }));
  root.querySelectorAll('[data-claim]').forEach((el) => el.addEventListener('click', () => {
    const id = el.dataset.claim;
    if (tab.status === 'done') return go('detail', { id });
    onClaim(root, params, id);
  }));
}

async function onClaim(root, params, billId) {
  const claim = (S().claims || []).find((c) => c.billId === billId);
  if (!claim) return;
  const b = billById(billId);
  const pick = await UI.sheet(`报销 ¥${fmtMoney(claim.amount)}`, [
    { label: '报销入账', icon: '✅', color: 'rgba(48,209,88,.18)' },
    { label: '部分报销', icon: '🧮', color: 'rgba(255,159,10,.18)' },
    { label: '查看原账单', icon: '🧾', color: 'rgba(10,132,255,.18)' },
    { label: '取消报销标记', icon: '↩️', color: 'rgba(255,69,58,.18)' },
  ]);
  if (!pick) return;

  if (pick.label === '查看原账单') return go('detail', { id: billId });

  if (pick.label === '取消报销标记') {
    clearClaim(billId);
    UI.toast('已取消报销标记');
    return refresh(root, params);
  }

  const cat = claimCat();
  if (!cat) return UI.toast('缺少收入分类');
  const accountId = b?.accountId || S().accounts[0]?.id || '';

  if (pick.label === '报销入账') {
    addBill({
      type: 'income',
      amount: +claim.amount || 0,
      categoryId: cat.id,
      accountId,
      date: todayStr(),
      note: `报销：${b?.note || cat.name}`,
      tags: ['报销'],
    });
    claim.status = 'done';
    claim.doneTime = Date.now();
    if (b) b.claim = 'done';
    upsertClaim(billId, { status: 'done', doneTime: claim.doneTime, amount: claim.amount });
    UI.toast('已报销入账 ✓');
    return refresh(root, params);
  }

  // 部分报销
  const input = await UI.prompt(`实收金额（共 ¥${fmtMoney(claim.amount)}）`, '输入实收金额', '', 'number');
  const got = parseFloat(input);
  if (!got || got <= 0) return UI.toast('金额无效');
  if (got >= (+claim.amount || 0)) return UI.toast('实收金额不小于待报销额，请使用「报销入账」');
  const diff = (+claim.amount || 0) - got;
  addBill({
    type: 'income',
    amount: got,
    categoryId: cat.id,
    accountId,
    date: todayStr(),
    note: `部分报销：${b?.note || cat.name}`,
    tags: ['报销'],
  });
  // 差额生成一笔新的待报销支出，留待后续
  addBill({
    type: 'expense',
    amount: diff,
    categoryId: b?.categoryId || cats('expense')[0]?.id || '',
    accountId,
    date: todayStr(),
    note: `${b?.note || cat.name}（报销差额）`,
    claim: 'pending',
  });
  claim.status = 'done';
  claim.doneTime = Date.now();
  if (b) b.claim = 'done';
  save();
  UI.toast(`已入账 ¥${fmtMoney(got)}，差额 ¥${fmtMoney(diff)} 待后续报销`);
  return refresh(root, params);
}

async function refresh(root, params) {
  root.innerHTML = await mod.render(params);
  bind(root, params);
  root.querySelectorAll('[data-go]').forEach((b) => b.addEventListener('click', () => go(b.dataset.go)));
}

export default mod;
