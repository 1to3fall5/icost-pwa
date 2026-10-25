// 资产 Tab 首页：净资产 / 借入借出 / 账户列表 / 资产管理
import Icons from '../icons.js';
import { S, accountStat, fmtMoney, updateAccount, save } from '../store.js';
import { esc } from '../util.js';
import { accMarkHTML } from '../caticon.js';
import { go, UI } from '../app.js';

const hide = () => !!S().settings.hideAmount;
const money = (n, forceNeg = false) => {
  if (hide()) return '****';
  n = +n || 0;
  if (n < 0) return '-¥' + fmtMoney(-n);           // 真实负余额保留负号
  if (forceNeg && n !== 0) return '-¥' + fmtMoney(n); // 负债类账户
  return '¥' + fmtMoney(n);
};
const isDebt = (a) => a.type === 'credit' || a.type === 'borrow';

// 局部重渲染（hash 不变时 go() 不触发 render）
function refresh() {
  const screen = document.getElementById('screen');
  Promise.resolve(mod.render()).then((html) => {
    screen.innerHTML = html;
    mod.mount(screen);
    screen.querySelectorAll('[data-go]').forEach((b) =>
      b.addEventListener('click', () => go(b.dataset.go)));
  });
}

function netCard() {
  const st = accountStat();
  return `
  <div class="net-card">
    <div class="net-label">
      <span>净资产</span>
      <button class="ad-eye" data-act="eye" aria-label="隐藏金额">${hide() ? Icons.eyeOff : Icons.eye}</button>
    </div>
    <div class="net-amt">${money(st.net, st.net < 0)}</div>
    <div class="net-sub">
      <span>总资产<b>${money(st.asset)}</b></span>
      <span>总负债<b>${money(st.debt)}</b></span>
    </div>
  </div>`;
}

function duoCard() {
  const st = accountStat();
  return `
  <div class="duo-grid">
    <div class="duo-card">
      <span class="badge-ic ad-duo-ic" style="background:#3a3a3c">${Icons.down}</span>
      <div><div class="lb">总借入</div><div class="amt">${money(st.borrowed)}</div></div>
    </div>
    <div class="duo-card">
      <span class="badge-ic ad-duo-ic" style="background:#30d158">${Icons.up}</span>
      <div><div class="lb">总借出</div><div class="amt">${money(st.lent)}</div></div>
    </div>
  </div>`;
}

function accList() {
  const list = S().accounts.filter((a) => !a.hidden && !a.archived);
  if (!list.length) return `<div class="empty-tip">暂无数据</div>`;
  return `
  <div class="cell-group">
    ${list.map((a) => `
      <div class="cell" data-acc="${a.id}">
        ${accMarkHTML({ name: a.name, icon: a.icon, color: a.color, type: a.type, cls: 'ci ad-acc-ic' })}
        <div class="cl">
          <div class="cell-title">${esc(a.name)}</div>
          ${a.includeNet === false ? `<div class="cell-sub">不计入净资产</div>` : ''}
        </div>
        <span class="ad-acc-amt${isDebt(a) ? ' debt' : ''}">${money(a.balance, isDebt(a) && +a.balance !== 0)}</span>
      </div>`).join('')}
  </div>`;
}

// ---------- 资产管理 ----------
function moveAccount(id, dir) {
  const list = S().accounts;
  const i = list.findIndex((a) => a.id === id);
  if (i < 0) return;
  let j = dir === -999 ? 0 : i + dir;
  if (j < 0 || j >= list.length) {
    UI.toast(dir < 0 ? '已经排在最前了' : '已经排在最后了');
    return;
  }
  const [it] = list.splice(i, 1);
  list.splice(j, 0, it);
  save();
  refresh();
}

async function openSort() {
  const list = S().accounts;
  if (!list.length) return UI.toast('暂无账户');
  const pick = await UI.sheet('排序', list.map((a) => ({
    label: a.name,
    icon: a.icon,
    color: a.color, kind: a.type,
    value: [a.hidden ? '已隐藏' : '', a.archived ? '已归档' : ''].filter(Boolean).join(' ') || '显示中',
    onClick: () => a.id,
  })));
  if (!pick) return;
  const id = pick.onClick();
  const acc = S().accounts.find((a) => a.id === id);
  const act = await UI.sheet(`调整「${acc ? acc.name : ''}」的顺序`, [
    { label: '上移', icon: 'up', onClick: () => moveAccount(id, -1) },
    { label: '下移', icon: 'down', onClick: () => moveAccount(id, 1) },
    { label: '移到最前', icon: 'sort', onClick: () => moveAccount(id, -999) },
  ]);
  act?.onClick?.();
}

async function openHide() {
  const list = S().accounts.filter((a) => !a.archived);
  if (!list.length) return UI.toast('暂无账户');
  const pick = await UI.sheet('隐藏资产', list.map((a) => ({
    label: a.name,
    icon: a.icon,
    color: a.color, kind: a.type,
    value: a.hidden ? '已隐藏' : '显示中',
    onClick: () => {
      updateAccount(a.id, { hidden: !a.hidden });
      UI.toast(a.hidden ? `已显示「${a.name}」` : `已隐藏「${a.name}」`);
    },
  })));
  if (pick) { pick.onClick?.(); refresh(); }
}

async function openArchive() {
  const list = S().accounts;
  if (!list.length) return UI.toast('暂无账户');
  const pick = await UI.sheet('归档资产', list.map((a) => ({
    label: a.name,
    icon: a.icon,
    color: a.color, kind: a.type,
    value: a.archived ? '已归档' : '使用中',
    onClick: () => {
      updateAccount(a.id, { archived: !a.archived });
      UI.toast(a.archived ? `已取消归档「${a.name}」` : `已归档「${a.name}」`);
    },
  })));
  if (pick) { pick.onClick?.(); refresh(); }
}

async function openManage() {
  const pick = await UI.sheet('资产管理', [
    { label: '排序', icon: 'sort', onClick: openSort },
    { label: '隐藏资产', icon: 'hide', onClick: openHide },
    { label: '归档资产', icon: 'archive', onClick: openArchive },
    { label: '账户说明', icon: 'help', onClick: () => UI.toast('净资产 = 总资产 − 总负债；隐藏后不计入统计，归档后不在列表显示', 3200) },
  ]);
  await pick?.onClick?.();
}

const mod = {
  header: 'large',
  title: '资产',
  navLeft: `<button class="nb-btn" data-act="nav-left">${Icons.plus}</button>`,
  navRight: `<button class="nb-btn" data-act="asset-manage">${Icons.more}</button><button class="nb-btn avatar" data-act="settings">${Icons.avatar}</button>`,

  render() {
    return `
      ${netCard()}
      <div style="height:12px"></div>
      ${duoCard()}
      <div class="sec-title">我的资产</div>
      ${accList()}`;
  },

  mount(root) {
    // 净资产：眼睛切换隐藏金额
    root.querySelector('[data-act="eye"]')?.addEventListener('click', () => {
      S().settings.hideAmount = !S().settings.hideAmount;
      save();
      refresh();
    });

    // 账户行 → 账户详情
    root.querySelectorAll('[data-acc]').forEach((el) =>
      el.addEventListener('click', () => go('assetdetail', { id: el.dataset.acc })));

    // 导航栏按钮：事件委托，只绑一次（避免 refresh 后监听器累积）
    if (!mod._navDelegated) {
      mod._navDelegated = true;
      document.getElementById('navbar').addEventListener('click', (e) => {
        const act = e.target.closest('[data-act]')?.dataset.act;
        if (act === 'nav-left') go('assetdetail');
        else if (act === 'asset-manage') openManage();
      });
    }
  },
};

export default mod;
