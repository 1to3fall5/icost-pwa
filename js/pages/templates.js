// 模板快捷记账
import { S, cats, accById, addBill, fmtMoney, save, uid, addTombstone } from '../store.js';
import { esc } from '../util.js';
import { catMarkHTML } from '../caticon.js';
import { go, UI } from '../app.js';

const p2 = (n) => String(n).padStart(2, '0');
const todayStr = () => {
  const d = new Date();
  return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
};
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

const draft = {
  open: false, id: null, type: 'expense', amount: '',
  categoryId: '', accountId: '', toAccountId: '', note: '',
};
function resetDraft(type = 'expense') {
  const s = S();
  Object.assign(draft, {
    open: true, id: null, type, amount: '',
    categoryId: cats(type)[0]?.id || '',
    accountId: s.accounts[0]?.id || '',
    toAccountId: s.accounts[1]?.id || '',
    note: '',
  });
}
function loadDraft(t) {
  Object.assign(draft, {
    open: true, id: t.id, type: t.type || 'expense', amount: String(t.amount ?? ''),
    categoryId: t.categoryId || '', accountId: t.accountId || '',
    toAccountId: t.toAccountId || '', note: t.note || '',
  });
}

function typeBadge(type) {
  return `<span class="tp-badge ${type}">${type === 'expense' ? '支' : type === 'income' ? '收' : '转'}</span>`;
}

function cardHTML(t) {
  const cat = catInfo(t.categoryId);
  const acc = accById(t.accountId);
  const acc2 = t.type === 'transfer' ? accById(t.toAccountId) : null;
  const color = t.type === 'transfer' ? '#0a84ff' : (cat?.color || '#98989f');
  const mark = catMarkHTML({
    name: cat?.name || '', parent: cat?.parent || '', icon: cat?.icon || '🧾',
    color, type: t.type, kind: t.type === 'transfer' ? 'transfer' : '', cls: 'badge-ic',
  });
  const name = t.type === 'transfer'
    ? `${acc?.name || '?'} → ${acc2?.name || '?'}`
    : (cat ? (cat.parent ? `${cat.parent} › ${cat.name}` : cat.name) : '未分类');
  const meta = t.type === 'transfer'
    ? `${acc?.name || ''} → ${acc2?.name || ''}`
    : (acc?.name || '未选账户');
  return `<div class="card tp-card">
    <div class="row1">
      ${mark}
      <span class="nm">${esc(name)}</span>
      <span class="amt">¥${fmtMoney(t.amount)}</span>
    </div>
    <div class="meta">${typeBadge(t.type)} ${esc(meta)}${t.note ? ' · ' + esc(t.note) : ''}</div>
    <div class="acts">
      <button class="tp-btn blue" data-use="${t.id}">使用</button>
      <button class="tp-btn" data-edit="${t.id}">编辑</button>
      <button class="tp-btn red" data-del="${t.id}">删除</button>
    </div>
  </div>`;
}

function formHTML() {
  const d = draft;
  const list = d.type === 'transfer' ? [] : cats(d.type);
  const acc = accById(d.accountId);
  const acc2 = accById(d.toAccountId);
  return `<div class="tp-form">
    <div class="sec-title" style="margin:0 0 8px">${d.id ? '编辑模板' : '新建模板'}</div>
    <div class="seg small" id="tp-type">
      <button data-t="expense" class="${d.type === 'expense' ? 'on' : ''}">支出</button>
      <button data-t="income" class="${d.type === 'income' ? 'on' : ''}">收入</button>
      <button data-t="transfer" class="${d.type === 'transfer' ? 'on' : ''}">转账</button>
    </div>
    ${d.type === 'transfer' ? '' : `<div class="form-label">分类</div>
      <div class="tp-cats">
        ${list.map((c) => `<button class="tp-cat ${c.id === d.categoryId ? 'on' : ''}" data-c="${c.id}">
          ${catMarkHTML({ name: c.name, icon: c.icon, color: c.color, type: c.type, cls: 'ic' })}${esc(c.name)}
        </button>`).join('')}
      </div>`}
    <div class="fr">
      <span class="fl">金额</span>
      <input class="form-input fv" id="tp-amt" type="number" inputmode="decimal" placeholder="0.00" value="${d.amount}">
    </div>
    <div class="fr">
      <span class="fl">备注</span>
      <input class="form-input fv" id="tp-note" placeholder="可留空" value="${esc(d.note)}">
    </div>
    <div class="fr">
      <span class="fl">${d.type === 'transfer' ? '账户' : '账户'}</span>
      <button class="form-input fv" id="tp-acc" style="text-align:left;background:var(--card2)">
        ${d.type === 'transfer'
          ? `${esc(acc?.name || '选择账户')} → ${esc(acc2?.name || '选择账户')}`
          : esc(acc?.name || '选择账户')}
      </button>
    </div>
    <div class="acts" style="margin-top:14px">
      <button class="tp-btn" data-act="cancel">取消</button>
      <button class="tp-btn blue" data-act="save">保存</button>
    </div>
  </div>`;
}

const mod = {
  title: '模板记账',
  header: 'sub',
  async render() {
    const list = S().templates || [];
    return `
      <div class="tp-tip">长按首页「+」可唤起模板；复刻版中请在本页直接使用模板。</div>
      ${draft.open ? formHTML() : ''}
      <div class="cell-group">
        <div class="cell" data-act="new">
          <span class="ci" style="background:rgba(10,132,255,.18)">➕</span>
          <span class="cl cell-title" style="color:var(--blue)">新建模板</span>
        </div>
      </div>
      ${list.length
        ? list.map(cardHTML).join('')
        : `<div class="empty-tip">暂无模板 · 把常用账单创建为模板，3 秒记账</div>`}
      <div style="height:10px"></div>`;
  },
  mount(root, params) { bind(root, params); },
};

function bind(root, params) {
  // 类型切换
  root.querySelectorAll('#tp-type [data-t]').forEach((b) => b.addEventListener('click', () => {
    const t = b.dataset.t;
    draft.type = t;
    draft.categoryId = cats(t)[0]?.id || '';
    refresh(root, params);
  }));
  // 分类
  root.querySelectorAll('[data-c]').forEach((b) => b.addEventListener('click', () => {
    draft.categoryId = b.dataset.c;
    refresh(root, params);
  }));
  // 输入
  const amt = root.querySelector('#tp-amt');
  amt?.addEventListener('input', () => { draft.amount = amt.value; });
  const note = root.querySelector('#tp-note');
  note?.addEventListener('input', () => { draft.note = note.value; });
  // 账户
  root.querySelector('#tp-acc')?.addEventListener('click', () => pickAcc(root, params));

  root.querySelector('[data-act="new"]')?.addEventListener('click', () => {
    resetDraft('expense');
    refresh(root, params);
  });
  root.querySelector('[data-act="cancel"]')?.addEventListener('click', () => {
    draft.open = false; draft.id = null;
    refresh(root, params);
  });
  root.querySelector('[data-act="save"]')?.addEventListener('click', () => saveForm(root, params));

  root.querySelectorAll('[data-use]').forEach((b) => b.addEventListener('click', () => {
    const t = S().templates.find((x) => x.id === b.dataset.use);
    if (!t) return;
    addBill({
      type: t.type,
      amount: +t.amount || 0,
      categoryId: t.type === 'transfer' ? '' : t.categoryId,
      accountId: t.accountId,
      toAccountId: t.type === 'transfer' ? t.toAccountId : undefined,
      date: todayStr(),
      note: t.note || '',
      tags: [...(t.tags || [])],
    });
    UI.toast('已按模板记账');
  }));
  root.querySelectorAll('[data-edit]').forEach((b) => b.addEventListener('click', () => {
    const t = S().templates.find((x) => x.id === b.dataset.edit);
    if (!t) return;
    loadDraft(t);
    refresh(root, params);
  }));
  root.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', async () => {
    const ok = await UI.confirm('删除这个模板？', '删除');
    if (!ok) return;
    S().templates = S().templates.filter((x) => x.id !== b.dataset.del);
    addTombstone('templates', b.dataset.del);
    save();
    UI.toast('已删除模板');
    refresh(root, params);
  }));
}

async function pickAcc(root, params) {
  const accs = S().accounts.filter((a) => !a.archived);
  const pick = await UI.sheet(draft.type === 'transfer' ? '转出账户' : '选择账户', accs.map((a) => ({
    label: a.name, icon: a.icon, color: a.color + '33', value: a.id === draft.accountId ? '✓' : '',
    id: a.id,
  })));
  if (!pick) return;
  draft.accountId = pick.id;
  if (draft.type === 'transfer') {
    if (draft.toAccountId === pick.id) draft.toAccountId = accs.find((x) => x.id !== pick.id)?.id || '';
    const p2nd = await UI.sheet('转入账户', accs.filter((a) => a.id !== draft.accountId).map((a) => ({
      label: a.name, icon: a.icon, color: a.color + '33', value: a.id === draft.toAccountId ? '✓' : '', id: a.id,
    })));
    if (p2nd) draft.toAccountId = p2nd.id;
  }
  refresh(root, params);
}

function saveForm(root, params) {
  const d = draft;
  const amount = parseFloat(d.amount);
  if (!amount || amount <= 0) return UI.toast('请输入金额');
  if (d.type !== 'transfer' && !d.categoryId) return UI.toast('请选择分类');
  if (!d.accountId) return UI.toast('请选择账户');
  const data = {
    type: d.type,
    amount,
    categoryId: d.type === 'transfer' ? '' : d.categoryId,
    accountId: d.accountId,
    toAccountId: d.type === 'transfer' ? d.toAccountId : '',
    note: d.note.trim(),
  };
  if (d.id) {
    const t = S().templates.find((x) => x.id === d.id);
    if (t) Object.assign(t, data);
  } else {
    S().templates.push({ id: uid(), ...data, tags: [], created: Date.now() });
  }
  save();
  draft.open = false; draft.id = null;
  UI.toast(d.id ? '模板已更新' : '模板已创建');
  refresh(root, params);
}

async function refresh(root, params) {
  root.innerHTML = await mod.render(params);
  bind(root, params);
  root.querySelectorAll('[data-go]').forEach((b) => b.addEventListener('click', () => go(b.dataset.go)));
}

export default mod;
