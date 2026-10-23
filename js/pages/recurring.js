// 周期记账
import { S, cats, accById, addBill, fmtMoney, save, uid, addTombstone } from '../store.js';
import { esc } from '../util.js';
import { catMarkHTML } from '../caticon.js';
import { go, UI } from '../app.js';

const p2 = (n) => String(n).padStart(2, '0');
const WD = '日一二三四五六';
const fmtD = (d) => `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
const todayStr = () => fmtD(new Date());
const parseD = (s) => new Date(String(s || todayStr()).replace(/-/g, '/'));

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
function cycleText(r) {
  if (r.cycle === 'day') return '每天';
  const d = parseD(r.nextDate);
  if (r.cycle === 'week') return `每周${WD[d.getDay()]}`;
  return `每月 ${d.getDate()} 日`;
}
function isDue(r) { return !!r.nextDate && r.nextDate <= todayStr(); }
function advance(dateStr, cycle) {
  const d = parseD(dateStr);
  if (cycle === 'day') d.setDate(d.getDate() + 1);
  else if (cycle === 'week') d.setDate(d.getDate() + 7);
  else {
    const y = d.getFullYear(), m = d.getMonth(), day = d.getDate();
    const last = new Date(y, m + 2, 0).getDate();
    return fmtD(new Date(y, m + 1, Math.min(day, last)));
  }
  return fmtD(d);
}
// 由开始日期 + 周期推算首次入账日
function computeNext(start, cycle, wd, md) {
  const base = start || todayStr();
  if (cycle === 'day') return base;
  const d = parseD(base);
  if (cycle === 'week') {
    d.setDate(d.getDate() + ((wd - d.getDay() + 7) % 7));
    return fmtD(d);
  }
  const y = d.getFullYear(), m = d.getMonth();
  const last = new Date(y, m + 1, 0).getDate();
  const nd = new Date(y, m, Math.min(md, last));
  if (nd < parseD(base)) {
    const l2 = new Date(y, m + 2, 0).getDate();
    return fmtD(new Date(y, m + 1, Math.min(md, l2)));
  }
  return fmtD(nd);
}

const draft = {
  open: false, id: null, type: 'expense', amount: '', categoryId: '', accountId: '',
  cycle: 'month', wd: new Date().getDay(), md: new Date().getDate(), startDate: todayStr(), note: '',
};
function resetDraft() {
  const s = S();
  Object.assign(draft, {
    open: true, id: null, type: 'expense', amount: '',
    categoryId: cats('expense')[0]?.id || '',
    accountId: s.accounts[0]?.id || '',
    cycle: 'month', wd: new Date().getDay(), md: new Date().getDate(),
    startDate: todayStr(), note: '',
  });
}
function loadDraft(r) {
  const d = parseD(r.nextDate);
  Object.assign(draft, {
    open: true, id: r.id, type: r.type || 'expense', amount: String(r.amount ?? ''),
    categoryId: r.categoryId || '', accountId: r.accountId || '',
    cycle: r.cycle || 'month', wd: d.getDay(), md: d.getDate(),
    startDate: r.nextDate || todayStr(), note: r.note || '',
  });
}

function cardHTML(r) {
  const cat = catInfo(r.categoryId);
  const acc = accById(r.accountId);
  const color = r.type === 'transfer' ? '#0a84ff' : (cat?.color || '#98989f');
  const mark = catMarkHTML({
    name: cat?.name || '', parent: cat?.parent || '', icon: cat?.icon || '🧾',
    color, type: r.type, kind: r.type === 'transfer' ? 'transfer' : '', cls: 'badge-ic',
  });
  const name = r.type === 'transfer' ? '账户转账' : (cat?.name || '未分类');
  const due = isDue(r);
  return `<div class="card rc-card ${due ? 'due' : ''}">
    <div class="row1">
      ${mark}
      <span class="nm">${esc(name)}${r.note ? `<span class="sub"> · ${esc(r.note)}</span>` : ''}</span>
      <span class="amt ${r.type === 'income' ? 'income' : ''}">¥${fmtMoney(r.amount)}</span>
    </div>
    <div class="meta">
      <span class="tp-badge ${r.type}">${r.type === 'expense' ? '支' : r.type === 'income' ? '收' : '转'}</span>
      ${esc(cycleText(r))} · ${esc(acc?.name || '未选账户')}
    </div>
    <div class="next">下次入账 <b class="dt-mono">${r.nextDate || '—'}</b>
      ${due ? '<span class="tp-badge pending">待入账</span>' : ''}
    </div>
    <div class="acts">
      <button class="tp-btn blue" data-run="${r.id}">立即入账</button>
      <button class="tp-btn" data-edit="${r.id}">编辑</button>
      <button class="tp-btn red" data-del="${r.id}">删除</button>
    </div>
  </div>`;
}

function formHTML() {
  const d = draft;
  const list = d.type === 'transfer' ? [] : cats(d.type);
  const acc = accById(d.accountId);
  return `<div class="tp-form">
    <div class="sec-title" style="margin:0 0 8px">${d.id ? '编辑周期' : '新建周期'}</div>
    <div class="seg small" id="rc-type">
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
      <input class="form-input fv" id="rc-amt" type="number" inputmode="decimal" placeholder="0.00" value="${d.amount}">
    </div>
    <div class="fr">
      <span class="fl">备注</span>
      <input class="form-input fv" id="rc-note" placeholder="可留空" value="${esc(d.note)}">
    </div>
    <div class="fr">
      <span class="fl">账户</span>
      <button class="form-input fv" id="rc-acc" style="text-align:left;background:var(--card2)">${esc(acc?.name || '选择账户')}</button>
    </div>
    <div class="form-label" style="margin-top:12px">周期</div>
    <div class="seg small" id="rc-cycle">
      <button data-c="day" class="${d.cycle === 'day' ? 'on' : ''}">每天</button>
      <button data-c="week" class="${d.cycle === 'week' ? 'on' : ''}">每周</button>
      <button data-c="month" class="${d.cycle === 'month' ? 'on' : ''}">每月</button>
    </div>
    ${d.cycle === 'week' ? `<div class="rc-picks">
      ${WD.split('').map((w, i) => `<button class="chip ${d.wd === i ? 'on' : ''}" data-wd="${i}">周${w}</button>`).join('')}
    </div>` : ''}
    ${d.cycle === 'month' ? `<div class="rc-picks">
      ${Array.from({ length: 31 }, (_, i) => i + 1).map((n) => `<button class="chip ${d.md === n ? 'on' : ''}" data-md="${n}">${n}</button>`).join('')}
    </div>` : ''}
    <div class="fr" style="margin-top:12px">
      <span class="fl">开始日期</span>
      <input class="form-input fv" id="rc-start" type="date" value="${d.startDate}">
    </div>
    <div class="acts" style="margin-top:14px">
      <button class="tp-btn" data-act="cancel">取消</button>
      <button class="tp-btn blue" data-act="save">保存</button>
    </div>
  </div>`;
}

const mod = {
  title: '周期记账',
  header: 'sub',
  async render() {
    const list = S().recurrings || [];
    const dueList = list.filter(isDue);
    return `
      <div class="rc-tip card" style="padding:12px 14px;font-size:13px;color:var(--text2);line-height:1.5">
        周期性固定收支可自动入账；修改周期仅影响后续生成的账单，已生成的账单不会被改动。
      </div>
      ${dueList.length ? `<button class="rc-runall" data-act="runall">执行全部到期项（${dueList.length}）</button>` : ''}
      ${draft.open ? formHTML() : ''}
      <div class="cell-group">
        <div class="cell" data-act="new">
          <span class="ci" style="background:rgba(10,132,255,.18)">➕</span>
          <span class="cl cell-title" style="color:var(--blue)">新建周期</span>
        </div>
      </div>
      ${list.length
        ? list.map(cardHTML).join('')
        : `<div class="empty-tip">暂无周期 · 把房租、工资等固定收支设为周期</div>`}
      <div style="height:10px"></div>`;
  },
  mount(root, params) { bind(root, params); },
};

function bind(root, params) {
  root.querySelectorAll('#rc-type [data-t]').forEach((b) => b.addEventListener('click', () => {
    draft.type = b.dataset.t;
    draft.categoryId = cats(draft.type)[0]?.id || '';
    refresh(root, params);
  }));
  root.querySelectorAll('#rc-cycle [data-c]').forEach((b) => b.addEventListener('click', () => {
    draft.cycle = b.dataset.c;
    refresh(root, params);
  }));
  root.querySelectorAll('[data-c]').forEach((b) => b.addEventListener('click', () => {
    if (!b.dataset.c || b.closest('#rc-cycle')) return;
    draft.categoryId = b.dataset.c;
    refresh(root, params);
  }));
  root.querySelectorAll('[data-wd]').forEach((b) => b.addEventListener('click', () => {
    draft.wd = +b.dataset.wd;
    refresh(root, params);
  }));
  root.querySelectorAll('[data-md]').forEach((b) => b.addEventListener('click', () => {
    draft.md = +b.dataset.md;
    refresh(root, params);
  }));
  root.querySelector('#rc-amt')?.addEventListener('input', (e) => { draft.amount = e.target.value; });
  root.querySelector('#rc-note')?.addEventListener('input', (e) => { draft.note = e.target.value; });
  root.querySelector('#rc-start')?.addEventListener('change', (e) => { draft.startDate = e.target.value || todayStr(); });
  root.querySelector('#rc-acc')?.addEventListener('click', async () => {
    const accs = S().accounts.filter((a) => !a.archived);
    const pick = await UI.sheet('选择账户', accs.map((a) => ({
      label: a.name, icon: a.icon, color: a.color + '33', value: a.id === draft.accountId ? '✓' : '', id: a.id,
    })));
    if (pick) { draft.accountId = pick.id; refresh(root, params); }
  });

  root.querySelector('[data-act="new"]')?.addEventListener('click', () => {
    resetDraft();
    refresh(root, params);
  });
  root.querySelector('[data-act="cancel"]')?.addEventListener('click', () => {
    draft.open = false; draft.id = null;
    refresh(root, params);
  });
  root.querySelector('[data-act="save"]')?.addEventListener('click', () => saveForm(root, params));

  root.querySelector('[data-act="runall"]')?.addEventListener('click', () => {
    const list = (S().recurrings || []).filter(isDue);
    if (!list.length) return UI.toast('没有到期项');
    let sum = 0;
    list.forEach((r) => { sum += runOne(r); });
    save();
    UI.toast(`已入账 ${list.length} 笔，共 ¥${fmtMoney(sum)}`);
    refresh(root, params);
  });

  root.querySelectorAll('[data-run]').forEach((b) => b.addEventListener('click', () => {
    const r = S().recurrings.find((x) => x.id === b.dataset.run);
    if (!r) return;
    const amt = runOne(r);
    save();
    UI.toast(`已入账 ¥${fmtMoney(amt)}，下次 ${r.nextDate}`);
    refresh(root, params);
  }));
  root.querySelectorAll('[data-edit]').forEach((b) => b.addEventListener('click', () => {
    const r = S().recurrings.find((x) => x.id === b.dataset.edit);
    if (!r) return;
    loadDraft(r);
    refresh(root, params);
  }));
  root.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', async () => {
    const ok = await UI.confirm('删除这个周期记账？', '删除');
    if (!ok) return;
    S().recurrings = S().recurrings.filter((x) => x.id !== b.dataset.del);
    addTombstone('recurrings', b.dataset.del);
    save();
    UI.toast('已删除');
    refresh(root, params);
  }));
}

// 生成一笔账单并推进下次日期
function runOne(r) {
  const amount = +r.amount || 0;
  addBill({
    type: r.type,
    amount,
    categoryId: r.type === 'transfer' ? '' : r.categoryId,
    accountId: r.accountId,
    date: r.nextDate || todayStr(),
    note: r.note || '',
    recurringId: r.id,
  });
  r.nextDate = advance(r.nextDate || todayStr(), r.cycle);
  return amount;
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
    cycle: d.cycle,
    nextDate: computeNext(d.startDate, d.cycle, d.wd, d.md),
    note: d.note.trim(),
  };
  if (d.id) {
    const r = S().recurrings.find((x) => x.id === d.id);
    if (r) Object.assign(r, data);
  } else {
    S().recurrings.push({ id: uid(), ...data });
  }
  save();
  draft.open = false; draft.id = null;
  UI.toast(d.id ? '周期已更新' : '周期已创建');
  refresh(root, params);
}

async function refresh(root, params) {
  root.innerHTML = await mod.render(params);
  bind(root, params);
  root.querySelectorAll('[data-go]').forEach((b) => b.addEventListener('click', () => go(b.dataset.go)));
}

export default mod;
