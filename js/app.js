// 应用外壳：hash 路由 + 导航栏 + TabBar + 弹层工具
import Icons from './icons.js';
import { load, deleteBill } from './store.js';

const app = {
  stack: [],          // [{route, params}]
  pages: {},          // route -> module
};

export const TABS = [
  { route: 'home', name: '账本', icon: 'book' },
  { route: 'asset', name: '资产', icon: 'layers' },
  { route: 'save', name: '存钱', icon: 'droplet' },
  { route: 'stats', name: '统计', icon: 'bars' },
];
export const isTab = (r) => TABS.some((t) => t.route === r);

// ---------- 路由 ----------
export function parseHash() {
  const h = location.hash.replace(/^#\/?/, '');
  if (!h) return { route: 'home', params: {} };
  const [route, qs] = h.split('?');
  const params = {};
  if (qs) new URLSearchParams(qs).forEach((v, k) => params[k] = v);
  return { route: route || 'home', params };
}
export function go(route, params = {}) {
  const qs = new URLSearchParams(params).toString();
  const target = `#/${route}${qs ? '?' + qs : ''}`;
  if (location.hash === target) render(); // 同路由重复导航也强制重渲染（数据可能已变）
  else location.hash = target;
}
export function back() {
  if (history.length > 1) history.back();
  else go('home');
}

const navbar = document.getElementById('navbar');
const screen = document.getElementById('screen');
const tabbar = document.getElementById('tabbar');

// 桌面（≥1024px）时侧栏常驻，并追加「记一笔 / 设置 / 更多」
export const isDesktop = () => typeof window.matchMedia === 'function'
  ? window.matchMedia('(min-width: 1024px)').matches
  : false;

function renderTabbar(active) {
  const desktop = isDesktop();
  tabbar.style.display = (isTab(active) || desktop) ? 'flex' : 'none';
  const addBtn = desktop
    ? `<button class="side-btn primary" data-act="record">${Icons.plus}<span>记一笔</span></button>`
    : '';
  const extra = desktop
    ? `<div class="side-sep"></div>
       <button class="side-btn" data-act="settings">${Icons.settings}<span>设置</span></button>
       <button class="side-btn" data-act="more">${Icons.more}<span>更多功能</span></button>`
    : '';
  tabbar.innerHTML = addBtn + TABS.map((t) => `
    <button class="tab-item ${active === t.route ? 'active' : ''}" data-go="${t.route}">
      ${Icons[t.icon](active === t.route)}<span>${t.name}</span>
    </button>`).join('') + extra;
  tabbar.querySelectorAll('[data-go]').forEach((b) =>
    b.addEventListener('click', () => go(b.dataset.go)));
  tabbar.querySelectorAll('[data-act]').forEach((b) => b.addEventListener('click', () => {
    const act = b.dataset.act;
    if (act === 'record') go('record');
    else if (act === 'settings') go('settings');
    else if (act === 'more') go('more');
  }));
}

// 窗口跨过 1024px 断点时重渲染（手机 ↔ 桌面布局切换）
let wasDesktop = isDesktop();
window.addEventListener('resize', () => {
  const now = isDesktop();
  if (now !== wasDesktop) { wasDesktop = now; render(); }
});

// 桌面快捷键：N 记一笔，1-4 切 Tab，Esc 返回
window.addEventListener('keydown', (e) => {
  if (!isDesktop()) return;
  const tag = (e.target.tagName || '').toLowerCase();
  if (tag === 'input' || tag === 'textarea' || tag === 'select') return;
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  if (e.key === 'n' || e.key === 'N') { e.preventDefault(); go('record'); }
  else if (['1', '2', '3', '4'].includes(e.key)) { e.preventDefault(); go(TABS[+e.key - 1].route); }
  else if (e.key === 'Escape') back();
});

// FAB（仅账本首页显示，由页面声明 fab:true）
let fabEl = null;
function renderFab(page, route) {
  if (fabEl) { fabEl.remove(); fabEl = null; }
  if (page.fab && isTab(route) && route === 'home') {
    fabEl = document.createElement('button');
    fabEl.className = 'fab';
    fabEl.innerHTML = Icons.plus;
    fabEl.addEventListener('click', () => go('record'));
    document.getElementById('app').appendChild(fabEl);
  }
}

export function renderFabCustom(route) { /* 供存钱等 tab 页复用 */ }

// 滚动时大标题折叠为小标题（模仿 iCost）
window.addEventListener('scroll', () => {
  const isLarge = !!navbar.querySelector('.nb-title') && !navbar.querySelector('.nb-title.center');
  navbar.classList.toggle('collapsed', isLarge && window.scrollY > 34);
}, { passive: true });

// ---------- 导航栏 ----------
function renderNav(page, route, params) {
  const mode = page.header || (isTab(route) ? 'large' : 'sub');
  const title = typeof page.title === 'function' ? page.title(params) : (page.title || '');
  const right = typeof page.navRight === 'function' ? page.navRight(params) : (page.navRight || null);
  if (mode === 'none') { navbar.innerHTML = ''; navbar.className = ''; return; }
  if (mode === 'large') {
    navbar.className = '';
    navbar.innerHTML = `
      <div class="nb-row">
        <div class="nb-side">${page.navLeft === '' ? '' : (page.navLeft || `<button class="nb-btn" data-act="nav-left">${Icons.swap}</button>`)}</div>
        <div class="nb-side">${right || `<button class="nb-btn" data-act="nav-more">${Icons.more}</button><button class="nb-btn avatar" data-act="settings">${Icons.avatar}</button>`}</div>
      </div>
      <div class="nb-title">${title}</div>
      <div class="nb-mini">${title}</div>`;
  } else {
    navbar.className = 'nb-solid';
    navbar.innerHTML = `
      <div class="nb-row">
        <div class="nb-side"><button class="nb-btn" data-act="back">${Icons.back}</button></div>
        <div class="nb-title center">${title}</div>
        <div class="nb-side">${right || ''}</div>
      </div>`;
  }
  navbar.querySelectorAll('[data-act]').forEach((b) => b.addEventListener('click', () => {
    const act = b.dataset.act;
    if (act === 'back') back();
    else if (act === 'settings') go('settings');
    else if (act === 'nav-more') go('settings');
    else if (page.onNavLeft) page.onNavLeft(params);
  }));
}

// ---------- 页面注册与渲染 ----------
export function registerPages(map) { Object.assign(app.pages, map); }

let cleanups = [];
export function onCleanup(fn) { cleanups.push(fn); }

async function render() {
  const { route, params } = parseHash();
  let page = app.pages[route];
  if (!page) { go('home'); return; }
  cleanups.forEach((fn) => { try { fn(); } catch {} });
  cleanups = [];
  renderNav(page, route, params);
  renderTabbar(route);
  renderFab(page, route);
  window.scrollTo(0, 0);
  screen.innerHTML = '';
  try {
    const html = await page.render(params);
    if (html instanceof Node) screen.appendChild(html);
    else screen.innerHTML = html;
    if (page.mount) page.mount(screen, params);
  } catch (e) {
    screen.innerHTML = `<div class="empty-tip">页面出错了：${e.message}</div>`;
    console.error(e);
  }
  screen.querySelectorAll('[data-go]').forEach((b) => b.addEventListener('click', () => go(b.dataset.go)));
  // 桌面表格行内操作（编辑 / 删除），手机端 .bill-actions 被隐藏，走长按/右键
  screen.querySelectorAll('[data-edit]').forEach((b) => b.addEventListener('click', (e) => {
    e.stopPropagation();
    go('record', { edit: b.dataset.edit });
  }));
  screen.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', async (e) => {
    e.stopPropagation();
    if (!(await UI.confirm('确定删除这笔账单？', '删除'))) return;
    deleteBill(b.dataset.del);
    UI.toast('已删除');
    const { route, params } = parseHash();
    go(route, params);
  }));
}

window.addEventListener('hashchange', render);

// ---------- UI 工具 ----------
export const UI = {
  toast(msg, ms = 1800) {
    const t = document.createElement('div');
    t.className = 'toast';
    t.textContent = msg;
    document.getElementById('overlay-root').appendChild(t);
    setTimeout(() => t.remove(), ms);
  },
  confirm(title, okText = '确认') {
    return new Promise((resolve) => {
      const ov = document.createElement('div');
      ov.className = 'overlay';
      ov.innerHTML = `<div class="panel center">
        <h3>${title}</h3>
        <div style="display:flex;gap:10px;margin-top:6px">
          <button class="form-input" data-r="0" style="flex:1;text-align:center;background:#3a3a3c">取消</button>
          <button class="form-input" data-r="1" style="flex:1;text-align:center;background:#ff453a;color:#fff;border-radius:12px">${okText}</button>
        </div></div>`;
      ov.addEventListener('click', (e) => {
        const r = e.target.dataset.r;
        if (r !== undefined) { ov.remove(); resolve(r === '1'); }
        else if (e.target === ov) { ov.remove(); resolve(false); }
      });
      document.getElementById('overlay-root').appendChild(ov);
    });
  },
  // 多选一：opts = [{label, desc, danger}]，返回选中下标，取消返回 -1
  choose(title, opts) {
    return new Promise((resolve) => {
      const ov = document.createElement('div');
      ov.className = 'overlay';
      ov.innerHTML = `<div class="panel">
        <h3>${title}</h3>
        <div class="opts">
          ${opts.map((o, i) => `<div class="cell" data-i="${i}">
            <span class="cl${o.danger ? ' st2-danger' : ''}">${o.label}${o.desc ? `<span class="cell-sub">${o.desc}</span>` : ''}</span>
          </div>`).join('')}
        </div>
        <button class="form-input" data-cancel style="margin-top:12px;text-align:center;background:#2c2c2e">取消</button>
      </div>`;
      ov.addEventListener('click', (e) => {
        const cell = e.target.closest('[data-i]');
        if (cell) { ov.remove(); resolve(+cell.dataset.i); }
        else if (e.target.closest('[data-cancel]') || e.target === ov) { ov.remove(); resolve(-1); }
      });
      document.getElementById('overlay-root').appendChild(ov);
    });
  },
  sheet(title, opts) {
    // opts: [{label, value, icon, onClick}] 或自定义 html
    return new Promise((resolve) => {
      const ov = document.createElement('div');
      ov.className = 'overlay';
      ov.innerHTML = `<div class="panel">
        ${title ? `<h3>${title}</h3>` : ''}
        <div class="opts">
          ${opts.map((o, i) => `<div class="cell" data-i="${i}">
            ${o.icon ? `<span class="ci" style="background:${o.color || '#2c2c2e'}">${o.icon}</span>` : ''}
            <span class="cl">${o.label}</span>${o.value ? `<span class="cv">${o.value}</span>` : ''}
          </div>`).join('')}
        </div>
        <button class="form-input" data-cancel style="margin-top:12px;text-align:center;background:#2c2c2e">取消</button>
      </div>`;
      ov.addEventListener('click', (e) => {
        const cell = e.target.closest('[data-i]');
        if (cell) { ov.remove(); resolve(opts[+cell.dataset.i]); }
        else if (e.target.closest('[data-cancel]') || e.target === ov) { ov.remove(); resolve(null); }
      });
      document.getElementById('overlay-root').appendChild(ov);
    });
  },
  prompt(title, placeholder = '', value = '', type = 'text') {
    return new Promise((resolve) => {
      const ov = document.createElement('div');
      ov.className = 'overlay';
      ov.innerHTML = `<div class="panel">
        <h3>${title}</h3>
        <input class="form-input" id="ovp-input" type="${type}" placeholder="${placeholder}" value="${value}">
        <div style="display:flex;gap:10px;margin-top:14px">
          <button class="form-input" data-r="0" style="flex:1;text-align:center;background:#3a3a3c">取消</button>
          <button class="form-input" data-r="1" style="flex:1;text-align:center;background:#0a84ff;color:#fff;border-radius:12px">确定</button>
        </div></div>`;
      const input = ov.querySelector('#ovp-input');
      setTimeout(() => input.focus(), 60);
      ov.addEventListener('click', (e) => {
        const r = e.target.dataset.r;
        if (r !== undefined) { ov.remove(); resolve(r === '1' ? input.value.trim() : null); }
        else if (e.target === ov) { ov.remove(); resolve(null); }
      });
      ov.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { ov.remove(); resolve(input.value.trim()); }
      });
      document.getElementById('overlay-root').appendChild(ov);
    });
  },
};

// 启动
load();
import('./pages/index.js').then((m) => {
  registerPages(m.pages);
  const st = load();
  document.body.classList.toggle('light', st.settings.theme === 'light');
  if (!location.hash) location.hash = `#/${st.settings.startPage === 'record' ? 'record' : 'home'}`; // 秒开模式
  render();
});
