// 记账页（支出 / 收入 / 转账）— 参考实现
import Icons from '../icons.js';
import { S, cats, accById, curBook, fmtMoney, addBill, updateBillAndBalance, billById, save, uid, today, clearClaim, upsertClaim } from '../store.js';
import { esc } from '../util.js';
import { catMarkHTML } from '../caticon.js';
import { back, go, UI } from '../app.js';

const KEYS = [['7', '8', '9', '÷'], ['4', '5', '6', '×'], ['1', '2', '3', '−'], ['0', '.', '⌫', '+']];

const mod = {
  title: () => '记一笔',
  header: 'sub',
  async render(params) {
    const s = S();
    const type = ['expense', 'income', 'transfer'].includes(params.type) ? params.type
      : (S().settings.defaultType || 'expense');
    const editId = params.edit || '';
    const bill = editId ? s.bills.find((b) => b.id === editId) : null;
    Object.assign(mod.data, {
      type,
      amount: bill ? String(bill.amount) : '',
      categoryId: bill?.categoryId || cats(type)[0]?.id || '',
      accountId: bill?.accountId || s.accounts[0]?.id || '',
      toAccountId: bill?.toAccountId || s.accounts[1]?.id || '',
      date: bill?.date || today(),
      time: bill?.time || new Date().toTimeString().slice(0, 5),
      note: bill?.note || '',
      claim: bill?.claim || (s.settings.claimEnabled && type === 'expense' ? null : null),
    });
    if (editId) mod.data.editId = editId; else mod.data.editId = '';
    return `
    <div class="sheet-page">
      <div class="sheet-head">
        <button class="x" data-act="close">${Icons.x}</button>
        <div class="tt">${editId ? '编辑账单' : '记一笔'}</div>
        <button class="ok" data-act="done">完成</button>
      </div>
      <div class="seg" style="margin:6px 16px 0" id="rec-type">
        <button data-t="expense" class="${type === 'expense' ? 'on' : ''}">支出</button>
        <button data-t="income" class="${type === 'income' ? 'on' : ''}">收入</button>
        <button data-t="transfer" class="${type === 'transfer' ? 'on' : ''}">转账</button>
      </div>
      <div class="amount-display"><span class="cur">¥</span><span class="val blink" id="rec-amt">${mod.data.amount || '0.00'}</span></div>
      <div class="cat-grid" id="rec-cats"></div>
      <div class="props-bar" id="rec-props"></div>
      <div class="keyboard" id="rec-kb">
        ${KEYS.map((row) => `<div class="kb-row">${row.map((k) =>
          `<button class="kb-key ${'÷×−+'.includes(k) ? 'op' : ''}" data-k="${k}">${k === '⌫' ? Icons.del : k}</button>`).join('')}
          ${row === KEYS[3] ? '' : ''}</div>`).join('')}
        <div class="kb-row"><button class="kb-key done" data-act="done">完 成</button></div>
      </div>
    </div>`;
  },
  data: {},
  mount(root) {
    const renderCats = () => {
      const { type, categoryId } = mod.data;
      const list = type === 'transfer' ? [] : cats(type);
      const grid = root.querySelector('#rec-cats');
      if (type === 'transfer') {
        grid.innerHTML = '';
        grid.style.display = 'none';
      } else {
        grid.style.display = '';
        grid.innerHTML = list.map((c) => `
          <button class="cat-item ${c.id === categoryId ? 'on' : ''}" data-c="${c.id}" style="--c:${c.color}">
            ${catMarkHTML({ name: c.name, icon: c.icon, color: c.color, type: c.type, cls: 'ic has-color' })}<span class="nm">${esc(c.name)}</span>
          </button>`).join('');
        grid.querySelectorAll('[data-c]').forEach((b) => b.addEventListener('click', () => {
          mod.data.categoryId = b.dataset.c;
          renderCats();
        }));
      }
    };
    const renderProps = () => {
      const d = mod.data;
      const acc = accById(d.accountId);
      const acc2 = accById(d.toAccountId);
      const chips = [];
      chips.push(`<button class="prop-chip" data-p="note">${Icons.note}<span class="v ${d.note ? '' : 'ph'}">${d.note || '备注'}</span></button>`);
      chips.push(`<button class="prop-chip" data-p="date">${Icons.calendar}<span class="v">${d.date.slice(5).replace('-', '/')}</span></button>`);
      if (S().settings.bookTime) chips.push(`<button class="prop-chip" data-p="time">🕐<span class="v">${d.time || '12:00'}</span></button>`);
      if (d.type === 'transfer') {
        chips.push(`<button class="prop-chip" data-p="acc">${Icons.wallet}<span class="v">${acc?.name || '选择账户'} → ${acc2?.name || ''}</span></button>`);
      } else {
        chips.push(`<button class="prop-chip" data-p="acc">${Icons.wallet}<span class="v">${acc?.name || '选择账户'}</span></button>`);
      }
      if (d.type === 'expense' && S().settings.claimEnabled) {
        chips.push(`<button class="prop-chip ${d.claim === 'pending' ? 'on' : ''}" data-p="claim">${Icons.claim}<span class="v">${d.claim === 'pending' ? '待报销 ✓' : '报销'}</span></button>`);
      }
      chips.push(`<button class="prop-chip" data-p="pic">${Icons.pic}<span class="v">图片</span></button>`);
      chips.push(`<button class="prop-chip" data-p="tag">${Icons.tag}<span class="v ${d.tags?.length ? '' : 'ph'}">${d.tags?.length ? d.tags.join(' ') : '标签'}</span></button>`);
      root.querySelector('#rec-props').innerHTML = chips.join('');
      root.querySelectorAll('[data-p]').forEach((b) => b.addEventListener('click', () => onProp(b.dataset.p)));
    };
    const onProp = async (p) => {
      const d = mod.data;
      if (p === 'note') {
        const v = await UI.prompt('备注', '输入备注…', d.note);
        if (v !== null) { d.note = v; renderProps(); }
      } else if (p === 'date') {
        const cur = d.date;
        const inp = await pickDate(d.date);
        if (inp) { d.date = inp; renderProps(); }
      } else if (p === 'time') {
        const v = await UI.prompt('账单时间', 'HH:MM', d.time || '12:00');
        if (v && /^\d{1,2}:\d{2}$/.test(v)) { d.time = v.padStart(5, '0'); renderProps(); }
      } else if (p === 'acc') {
        const accs = S().accounts.filter((a) => !a.archived);
        const pick = await UI.sheet(d.type === 'transfer' ? '转出账户' : '选择账户', accs.map((a) => ({
          label: a.name, icon: a.icon, color: a.color + '33', value: a.id === d.accountId ? '✓' : '',
          onClick: () => {
            if (d.type === 'transfer') {
              d.accountId = a.id;
              if (d.toAccountId === a.id) d.toAccountId = accs.find((x) => x.id !== a.id)?.id;
            } else d.accountId = a.id;
          },
        })));
        if (pick) {
          pick.onClick?.();
          if (d.type === 'transfer') {
            const accs2 = S().accounts.filter((a) => !a.archived && a.id !== d.accountId);
            const p2 = await UI.sheet('转入账户', accs2.map((a) => ({
              label: a.name, icon: a.icon, color: a.color + '33', value: a.id === d.toAccountId ? '✓' : '', onClick: () => { d.toAccountId = a.id; },
            })));
            p2?.onClick?.();
          }
          renderProps();
        }
      } else if (p === 'claim') {
        d.claim = d.claim === 'pending' ? null : 'pending';
        renderProps();
      } else if (p === 'pic') {
        UI.toast('复刻版：图片记账为演示功能');
      } else if (p === 'tag') {
        const v = await UI.prompt('标签（空格分隔）', '如：出差 公告', (d.tags || []).join(' '));
        if (v !== null) { d.tags = v ? v.split(/\s+/) : []; renderProps(); }
      }
    };
    const pickDate = (cur) => new Promise((resolve) => {
      const ov = document.createElement('div');
      ov.className = 'overlay';
      ov.innerHTML = `<div class="panel"><h3>选择日期</h3>
        <input class="form-input" type="date" value="${cur}" id="pd-in">
        <div style="display:flex;gap:10px;margin-top:14px">
          <button class="form-input" data-r="0" style="flex:1;text-align:center;background:#3a3a3c">取消</button>
          <button class="form-input" data-r="1" style="flex:1;text-align:center;background:#0a84ff;color:#fff;border-radius:12px">确定</button>
        </div></div>`;
      const inp = ov.querySelector('#pd-in');
      ov.addEventListener('click', (e) => {
        const r = e.target.dataset.r;
        if (r !== undefined) { ov.remove(); resolve(r === '1' ? inp.value : null); }
      });
      document.getElementById('overlay-root').appendChild(ov);
    });

    // 键盘（带简易计算器）
    const press = (k) => {
      const d = mod.data;
      let a = d.amount;
      if (k === '⌫') a = a.slice(0, -1);
      else if ('÷×−+'.includes(k)) { if (a && !'÷×−+'.includes(a.slice(-1))) a += k === '−' ? '-' : k; }
      else if (k === '.') { if (!a.includes('.')) a += a ? '.' : '0.'; }
      else a += k;
      if (a.length > 12) return;
      d.amount = a;
      // 尝试计算
      const val = calc(a);
      root.querySelector('#rec-amt').textContent = val;
    };
    const calc = (expr) => {
      try {
        const clean = expr.replace(/×/g, '*').replace(/÷/g, '/').replace(/−/g, '-');
        if (/[^0-9+\-*/.]/.test(clean) || !clean) return '0.00';
        // eslint-disable-next-line no-new-func
        const r = Function('"use strict";return (' + clean + ')')();
        if (!isFinite(r)) return '0.00';
        return (Math.round(r * 100) / 100).toFixed(2);
      } catch { return '0.00'; }
    };
    root.querySelectorAll('[data-k]').forEach((b) => b.addEventListener('click', () => press(b.dataset.k)));

    root.querySelectorAll('#rec-type [data-t]').forEach((b) => b.addEventListener('click', () => {
      const t = b.dataset.t;
      if (t === mod.data.type) return;
      go('record', { type: t });
    }));

    const done = () => {
      const d = mod.data;
      const amount = parseFloat(calc(d.amount));
      if (!amount || amount <= 0) return UI.toast('请输入金额');
      if (d.type !== 'transfer' && !d.categoryId) return UI.toast('请选择分类');
      const patch = {
        type: d.type,
        amount,
        categoryId: d.type === 'transfer' ? '' : d.categoryId,
        accountId: d.accountId,
        toAccountId: d.type === 'transfer' ? d.toAccountId : undefined,
        date: d.date,
        note: d.note,
        tags: d.tags || [],
        claim: d.claim,
        time: d.time,
      };
      if (d.editId) {
        if (billById(d.editId)) {
          // 回滚旧余额 + 应用新余额都在 store 里做，页面不碰加减法
          updateBillAndBalance(d.editId, patch);
          // 同步报销记录
          const s = S();
          const c = s.claims.find((x) => x.billId === d.editId);
          if (c) {
            if (patch.claim === 'pending') upsertClaim(d.editId, { amount });
            else clearClaim(d.editId);        // 取消标记也要落墓碑，否则对端合并会复活
          } else if (patch.claim === 'pending') {
            upsertClaim(d.editId, { amount, status: 'pending' });
          }
          save();
        }
        UI.toast('账单已更新 ✓');
      } else {
        addBill(patch);
        UI.toast('已记一笔 ✓');
      }
      setTimeout(() => go('home'), 350);
    };
    root.querySelectorAll('[data-act="done"]').forEach((b) => b.addEventListener('click', done));
    root.querySelector('[data-act="close"]').addEventListener('click', () => back());

    renderCats();
    renderProps();
  },
};

export default mod;
