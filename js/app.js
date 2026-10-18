// 应用外壳：hash 路由 + 导航栏 + TabBar + 弹层工具
import Icons from './icons.js';
import { load } from './store.js';

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

function renderTabbar(active) {
  tabbar.style.display = isTab(active) ? 'flex' : 'none';
  tabbar.innerHTML = TABS.map((t) => `
    <button class="tab-item ${active === t.route ? 'active' : ''}" data-go="${t.route}">
      ${Icons[t.icon](active === t.route)}<span>${t.name}</span>
    </button>`).join('');
  tabbar.querySelectorAll('[data-go]').forEach((b) =>
    b.addEventListener('click', () => go(b.dataset.go)));
}

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
