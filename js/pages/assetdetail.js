// 账户详情 / 添加账户
import Icons from '../icons.js';
import { S, accById, addAccount, updateAccount, bookBills, catById, fmtMoney, save } from '../store.js';
import { go, back, UI } from '../app.js';

const TYPES = [
  ['现金', 'cash'], ['储蓄卡', 'bank'], ['信用卡', 'credit'], ['线上账户', 'online'],
  ['投资', 'invest'], ['借出', 'lend'], ['借入', 'borrow'],
];
const typeName = (t) => (TYPES.find((x) => x[1] === t) || TYPES[0])[0];

const form = {
  id: '', name: '', icon: '💵', color: '#2c2c2e', type: 'cash',
  initBalance: 0, balance: 0, includeNet: true, hidden: false, archived: false,
};

const swRow = (key, label, sub) => `
  <div class="cell" data-sw="${key}">
    <div class="cl">
      <div class="cell-title">${label}</div>
      ${sub ? `<div class="cell-sub">${sub}</div>` : ''}
    </div>
    <label class="switch"><input type="checkbox" data-sw-in="${key}" ${form[key] ? 'checked' : ''}><i></i></label>
  </div>`;

function billRows(id) {
  const list = bookBills().filter((b) => b.accountId === id || b.toAccountId === id);
  if (!list.length) return `<div class="empty-tip">暂无数据</div>`;
  return list.map((b) => {
    const cat = catById(b.categoryId);
    const cls = b.type === 'income' ? 'income' : b.type === 'transfer' ? 'transfer' : 'expense';
    const sign = b.type === 'income' ? '+' : b.type === 'transfer' ? '' : '-';
    return `
    <div class="bill-row" data-bill="${b.id}">
      <div class="bill-ic" style="background:${(cat?.color || '#98989f')}22">${cat?.icon || (b.type === 'transfer' ? '🔄' : '🧾')}</div>
      <div class="bill-main">
        <div class="bill-cat">${cat?.name || (b.type === 'transfer' ? '账户转账' : '其他')}</div>
        <div class="bill-note">${b.date}${b.note ? ' · ' + b.note : ''}</div>
      </div>
      <div class="bill-amt ${cls}">${sign}¥${fmtMoney(b.amount)}</div>
    </div>`;
  }).join('');
}

const mod = {
  header: 'sub',
  title: (params) => (params && params.id ? '账户详情' : '添加账户'),
  navRight: `<button class="nb-btn text" data-act="save">保存</button>`,

  render(params) {
    const acc = params && params.id ? accById(params.id) : null;
    if (acc) {
      Object.assign(form, {
        id: acc.id,
        name: acc.name,
        icon: acc.icon,
        color: acc.color || '#2c2c2e',
        type: acc.type,
        initBalance: acc.initBalance === undefined ? acc.balance : acc.initBalance,
        balance: acc.balance,
        includeNet: acc.includeNet !== false,
        hidden: !!acc.hidden,
        archived: !!acc.archived,
      });
    } else {
      Object.assign(form, {
        id: '', name: '', icon: '💵', color: '#2c2c2e', type: 'cash',
        initBalance: 0, balance: 0, includeNet: true, hidden: false, archived: false,
      });
    }
    return `
      <div class="form-group">
        <label class="form-label">账户名称</label>
        <input class="form-input" id="ad-name" placeholder="如：招商银行储蓄卡" value="${form.name}">
      </div>

      <div class="cell-group">
        <div class="cell" data-act="icon">
          <span class="ci ad-acc-ic" style="background:${form.color || '#2c2c2e'}22">${form.icon}</span>
          <div class="cl"><div class="cell-title">图标</div><div class="cell-sub">点击修改 emoji</div></div>
          <span class="arrow">${Icons.chevR}</span>
        </div>
        <div class="cell" data-act="type">
          <span class="ci" style="background:#2c2c2e">🏦</span>
          <div class="cl"><div class="cell-title">类型</div></div>
          <span class="cv">${typeName(form.type)}</span>
          <span class="arrow">${Icons.chevR}</span>
        </div>
      </div>

      <div class="sec-title">余额</div>
      <div class="cell-group">
        <div class="cell">
          <div class="cl"><div class="cell-title">初始余额</div></div>
          <input class="form-input ad-inline" id="ad-init" type="number" inputmode="decimal" placeholder="0.00" value="${form.initBalance}">
        </div>
        <div class="cell">
          <div class="cl"><div class="cell-title">当前余额</div></div>
          <input class="form-input ad-inline" id="ad-bal" type="number" inputmode="decimal" placeholder="0.00" value="${form.balance}">
        </div>
      </div>

      <div class="sec-title">选项</div>
      <div class="cell-group">
        ${swRow('includeNet', '计入净资产', '关闭后不参与净资产统计')}
        ${swRow('hidden', '隐藏账户', '隐藏后不在资产列表显示')}
        ${swRow('archived', '归档账户', '归档后不再用于记账')}
      </div>

      ${form.id ? `
        <button class="form-input ad-danger" data-act="del" style="margin-top:20px">删除账户</button>
        <div class="sec-title">账户流水</div>
        ${billRows(form.id)}
      ` : ''}`;
  },

  mount(root) {
    const readForm = () => {
      form.name = (root.querySelector('#ad-name')?.value || '').trim();
      form.initBalance = parseFloat(root.querySelector('#ad-init')?.value) || 0;
      form.balance = parseFloat(root.querySelector('#ad-bal')?.value) || 0;
      root.querySelectorAll('[data-sw-in]').forEach((inp) => { form[inp.dataset.swIn] = inp.checked; });
    };

    // 图标 emoji
    root.querySelector('[data-act="icon"]')?.addEventListener('click', async () => {
      const v = await UI.prompt('账户图标', '输入一个 emoji，如 💳', form.icon);
      if (v) { form.icon = v; const el = root.querySelector('[data-act="icon"] .ad-acc-ic'); if (el) el.textContent = v; }
    });

    // 类型
    root.querySelector('[data-act="type"]')?.addEventListener('click', async () => {
      const pick = await UI.sheet('账户类型', TYPES.map(([nm, t]) => ({
        label: nm, icon: t === 'credit' ? '🪪' : '🏦', color: '#2c2c2e',
        value: form.type === t ? '✓' : '',
        onClick: () => { form.type = t; },
      })));
      if (!pick) return;
      pick.onClick?.();
      const cv = root.querySelector('[data-act="type"] .cv');
      if (cv) cv.textContent = typeName(form.type);
    });

    // 开关
    root.querySelectorAll('[data-sw]').forEach((cell) => {
      const inp = cell.querySelector('[data-sw-in]');
      inp.addEventListener('change', () => { form[inp.dataset.swIn] = inp.checked; });
    });

    // 流水 → 账单详情
    root.querySelectorAll('[data-bill]').forEach((r) =>
      r.addEventListener('click', () => go('detail', { id: r.dataset.bill })));

    // 删除
    root.querySelector('[data-act="del"]')?.addEventListener('click', async () => {
      const related = bookBills().filter((b) => b.accountId === form.id).length;
      const ok = await UI.confirm(
        related ? `该账户下有 ${related} 笔账单，删除账户后账单仍会保留，确认删除？` : '确认删除该账户？',
        '删除');
      if (!ok) return;
      S().accounts = S().accounts.filter((a) => a.id !== form.id);
      save();
      UI.toast('已删除账户');
      setTimeout(() => back(), 300);
    });

    // 保存（导航栏右侧文字按钮）
    document.querySelector('#navbar [data-act="save"]')?.addEventListener('click', () => {
      readForm();
      if (!form.name) return UI.toast('请填写账户名称');
      const patch = {
        name: form.name,
        icon: form.icon,
        type: form.type,
        initBalance: form.initBalance,
        balance: form.balance,
        includeNet: form.includeNet,
        hidden: form.hidden,
        archived: form.archived,
      };
      if (form.id) { updateAccount(form.id, patch); UI.toast('已保存 ✓'); }
      else { addAccount(patch); UI.toast('已添加账户 ✓'); }
      setTimeout(() => back(), 320);
    });
  },
};

export default mod;
