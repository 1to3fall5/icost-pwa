// 应用外壳：hash 路由 + 导航栏 + TabBar + 弹层工具
import Icons from './icons.js';
import { load, deleteBill, subscribe, curBook, onSaveError } from './store.js';
import { esc } from './util.js';
import { restorePassword, scheduleAutoPush, runAutoSync, onAutoSync, syncCfg, fmtTime } from './sync.js';

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

// 桌面侧栏：品牌区 + 账本切换 + 分组导航 + 同步状态（手机端仍是底部 TabBar）
const SIDE_GROUPS = [
  {
    title: '总览',
    items: [
      { route: 'home', name: '账本总览', icon: 'book', fn: true },
      { route: 'asset', name: '资产', icon: 'layers', fn: true },
      { route: 'stats', name: '统计', icon: 'bars', fn: true },
    ],
  },
  {
    title: '我的账本',
    items: [
      { route: 'calendar', name: '收支日历', icon: 'calendar' },
      { route: 'budget', name: '预算', icon: 'chart' },
      { route: 'save', name: '存钱计划', icon: 'target' },
      { route: 'templates', name: '快捷模板', icon: 'tag' },
      { route: 'recurring', name: '周期记账', icon: 'loop' },
      { route: 'claim', name: '报销', icon: 'claim' },
    ],
  },
  {
    title: '工具',
    items: [
      { route: 'importcsv', name: '导入账单', icon: 'export' },
      { route: 'importexport', name: '备份与同步', icon: 'lock' },
      { route: 'category', name: '分类管理', icon: 'pie' },
      { route: 'more', name: '更多功能', icon: 'more' },
      { route: 'settings', name: '设置', icon: 'settings' },
    ],
  },
];

function renderSidebar(active) {
  const book = curBook();
  const cfg = syncCfg();
  const on = !!cfg.gistId;
  const act = (i) => (active === i.route ? ' active' : '');
  const ico = (i) => (i.fn ? Icons[i.icon](active === i.route) : Icons[i.icon]);
  tabbar.innerHTML = `
    <div class="side-brand">
      <span class="side-logo">¥</span>
      <div class="side-brand-t"><b>iCost</b><span>记账 · 网页版</span></div>
    </div>
    <button class="side-book" data-act="books" title="切换账本">
      <span class="sb-ic">${esc(book?.icon || '📔')}</span>
      <span class="sb-nm">${esc(book?.name || '账本')}</span>
      <span class="sb-ch">${Icons.chevD.replace('<svg', '<svg style="width:14px;height:14px"')}</span>
    </button>
    <button class="side-btn primary" data-act="record">${Icons.plus}<span>记一笔</span></button>
    <div class="side-scroll">
      ${SIDE_GROUPS.map((g) => `
        <div class="side-group">
          <div class="side-gt">${g.title}</div>
          ${g.items.map((i) => {
            if (i.fn) return `<button class="tab-item${act(i)}" data-go="${i.route}">${ico(i)}<span>${i.name}</span></button>`;
            return `<button class="side-item${act(i)}" data-go="${i.route}">${ico(i)}<span>${i.name}</span></button>`;
          }).join('')}
        </div>`).join('')}
    </div>
    <button class="side-sync${on ? ' on' : ''}" data-act="sync">
      <i class="sdot"></i>
      <div class="ss-t"><b>${on ? '云端已同步' : '未开启云同步'}</b><span>${on ? (cfg.lastSync ? fmtTime(cfg.lastSync) : '已连接 Gist') : '点此配置加密同步'}</span></div>
    </button>`;
  tabbar.querySelectorAll('[data-go]').forEach((b) =>
    b.addEventListener('click', () => go(b.dataset.go)));
  tabbar.querySelectorAll('[data-act]').forEach((b) => b.addEventListener('click', () => {
    const a = b.dataset.act;
    if (a === 'record') go('record');
    else if (a === 'sync') go('importexport');
    else if (a === 'books') switchBook();
  }));
}

// 桌面切换账本（侧栏顶部下拉）
async function switchBook() {
  const s = load();
  const pick = await UI.sheet('切换账本', [
    ...s.books.filter((b) => !b.archived).map((b) => ({
      label: b.name, icon: b.icon, value: b.id === s.currentBookId ? '当前' : '',
      onClick: () => { s.currentBookId = b.id; },
    })),
    { label: '管理账本', icon: '⚙️', onClick: () => go('books') },
  ]);
  if (!pick) return;
  pick.onClick?.();
  const { save } = await import('./store.js');
  save();
  go(parseHash().route, parseHash().params);
}

function renderTabbar(active) {
  const desktop = isDesktop();
  tabbar.style.display = (isTab(active) || desktop) ? 'flex' : 'none';
  if (desktop) { renderSidebar(active); return; }
  tabbar.innerHTML = TABS.map((t) => `
    <button class="tab-item ${active === t.route ? 'active' : ''}" data-go="${t.route}">
      ${Icons[t.icon](active === t.route)}<span>${t.name}</span>
    </button>`).join('');
  tabbar.querySelectorAll('[data-go]').forEach((b) =>
    b.addEventListener('click', () => go(b.dataset.go)));
}

// 窗口跨过 1024px 断点时重渲染（手机 ↔ 桌面布局切换）
let wasDesktop = isDesktop();
window.addEventListener('resize', () => {
  const now = isDesktop();
  if (now !== wasDesktop) { wasDesktop = now; render(); }
});

// 桌面快捷键：N 记一笔，1-4 切 Tab，Esc 返回
// 弹层开着时 Esc 归弹层（关闭当前弹层），不能同时把整个页面导航走
const overlayOpen = () => !!document.querySelector('#overlay-root .overlay');
window.addEventListener('keydown', (e) => {
  if (!isDesktop()) return;
  if (e.key === 'Escape' && overlayOpen()) return;
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

// 桌面侧栏整屏：把「吸顶导航实测高度」写进 --side-top，
// 侧栏的起点与高度都跟着它走（大标题页 / 子页 / 折叠态高度各不相同）
let sideTopRaf = 0;
function syncSideTop() {
  const appEl = document.getElementById('app');
  if (!appEl || !isDesktop()) return;
  const h = navbar.offsetHeight;
  if (h > 0) appEl.style.setProperty('--side-top', h + 'px');
}
function queueSideTop() {
  if (sideTopRaf) return;
  sideTopRaf = requestAnimationFrame(() => { sideTopRaf = 0; syncSideTop(); });
}

// 滚动时大标题折叠为小标题（模仿 iCost）
window.addEventListener('scroll', () => {
  const isLarge = !!navbar.querySelector('.nb-title') && !navbar.querySelector('.nb-title.center');
  navbar.classList.toggle('collapsed', isLarge && window.scrollY > 34);
  queueSideTop();
}, { passive: true });
window.addEventListener('resize', queueSideTop);

// ---------- 导航栏 ----------
function renderNav(page, route, params) {
  const mode = page.header || (isTab(route) ? 'large' : 'sub');
  const title = typeof page.title === 'function' ? page.title(params) : (page.title || '');
  // 标题可能回显 params（如存钱计划名 / URL 传参），必须转义
  const titleHTML = esc(title);
  const right = typeof page.navRight === 'function' ? page.navRight(params) : (page.navRight || null);
  if (mode === 'none') { navbar.innerHTML = ''; navbar.className = ''; return; }
  if (mode === 'large') {
    navbar.className = '';
    navbar.innerHTML = `
      <div class="nb-row">
        <div class="nb-side">${page.navLeft === '' ? '' : (page.navLeft || `<button class="nb-btn" data-act="nav-left">${Icons.swap}</button>`)}</div>
        <div class="nb-side">${right || `<button class="nb-btn" data-act="nav-more">${Icons.more}</button><button class="nb-btn avatar" data-act="settings">${Icons.avatar}</button>`}</div>
      </div>
      <div class="nb-title">${titleHTML}</div>
      <div class="nb-mini">${titleHTML}</div>`;
  } else {
    navbar.className = 'nb-solid';
    navbar.innerHTML = `
      <div class="nb-row">
        <div class="nb-side"><button class="nb-btn" data-act="back">${Icons.back}</button></div>
        <div class="nb-title center">${titleHTML}</div>
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
  syncSideTop();
  window.scrollTo(0, 0);
  // 桌面首页是总览仪表盘，占满整屏宽度（其它页面仍居中，避免列表被拉得过长）
  screen.classList.toggle('screen-full', isDesktop() && route === 'home');
  screen.innerHTML = '';
  try {
    const html = await page.render(params);
    if (html instanceof Node) screen.appendChild(html);
    else screen.innerHTML = html;
    if (page.mount) page.mount(screen, params);
  } catch (e) {
    screen.innerHTML = `<div class="empty-tip">页面出错了：${esc(e.message)}</div>`;
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
// 弹层里的 title / label / value 都可能是用户数据（账本名、分类名、金额…），
// icon 与 color 走校验而不是转义 —— 它们进的是 style 属性，转义挡不住 CSS 上下文注入
const safeColor = (c) => (/^(#[0-9a-fA-F]{3,8}|rgba?\([\d.,\s%]+\)|[a-zA-Z]+)$/.test(String(c || '')) ? c : '#2c2c2e');

// 弹层的公共收尾：语义、焦点、Esc、点遮罩关闭。
// 原来直接 append 一个 div：屏幕阅读器读不到"这是一个对话框"，键盘用户 Tab 会跑到背后的页面，
// 桌面端按 Esc 还会触发全局「返回」把整个页面导航走。
// 关掉时必须还原焦点，否则焦点掉回 body，键盘用户就"迷失"了。
const FOCUSABLE = 'button, [href], input, textarea, select, [tabindex]:not([tabindex="-1"])';

function openOverlay(ov, { onEscape }) {
  const opener = document.activeElement;
  const panel = ov.querySelector('.panel');
  if (panel) {
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-modal', 'true');
    const title = panel.querySelector('h3');
    if (title) {
      if (!title.id) title.id = 'ovl-title-' + Math.random().toString(36).slice(2, 7);
      panel.setAttribute('aria-labelledby', title.id);
    }
  }

  // 焦点陷阱：Tab / Shift+Tab 只在弹层内循环
  const onKey = (e) => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onEscape(); return; }
    if (e.key !== 'Tab' || !panel) return;
    const items = [...panel.querySelectorAll(FOCUSABLE)].filter((el) => !el.disabled && el.offsetParent !== null);
    if (!items.length) return;
    const first = items[0]; const last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  };
  // 捕获阶段拦下 Esc，避免同时触发 window 上的全局返回
  ov.addEventListener('keydown', onKey, true);

  document.getElementById('overlay-root').appendChild(ov);

  return {
    // 关闭：先摘掉监听再把焦点还给触发者
    close() {
      ov.removeEventListener('keydown', onKey, true);
      ov.remove();
      if (opener && typeof opener.focus === 'function' && document.contains(opener)) {
        try { opener.focus({ preventScroll: true }); } catch { opener.focus(); }
      }
    },
    // 首次聚焦：优先给输入框，其次第一个按钮
    focusFirst(el) {
      const target = el || panel?.querySelector('input, button');
      if (target) setTimeout(() => { try { target.focus({ preventScroll: true }); } catch {} }, 60);
    },
  };
}

export const UI = {
  toast(msg, ms = 1800) {
    const t = document.createElement('div');
    t.className = 'toast';
    t.setAttribute('role', 'status');
    t.setAttribute('aria-live', 'polite');
    t.textContent = msg;
    document.getElementById('overlay-root').appendChild(t);
    setTimeout(() => t.remove(), ms);
  },
  confirm(title, okText = '确认') {
    return new Promise((resolve) => {
      const ov = document.createElement('div');
      ov.className = 'overlay';
      ov.innerHTML = `<div class="panel center">
        <h3>${esc(title)}</h3>
        <div style="display:flex;gap:10px;margin-top:6px">
          <button class="form-input" data-r="0" style="flex:1;text-align:center;background:#3a3a3c">取消</button>
          <button class="form-input" data-r="1" style="flex:1;text-align:center;background:#ff453a;color:#fff;border-radius:12px">${esc(okText)}</button>
        </div></div>`;
      const h = openOverlay(ov, () => { h.close(); resolve(false); });
      ov.addEventListener('click', (e) => {
        const r = e.target.dataset.r;
        if (r !== undefined) { h.close(); resolve(r === '1'); }
        else if (e.target === ov) { h.close(); resolve(false); }
      });
      h.focusFirst();
    });
  },
  // 多选一：opts = [{label, desc, danger}]，返回选中下标，取消返回 -1
  choose(title, opts) {
    return new Promise((resolve) => {
      const ov = document.createElement('div');
      ov.className = 'overlay';
      ov.innerHTML = `<div class="panel">
        <h3>${esc(title)}</h3>
        <div class="opts">
          ${opts.map((o, i) => `<div class="cell" data-i="${i}" role="button" tabindex="0">
            <span class="cl${o.danger ? ' st2-danger' : ''}">${esc(o.label)}${o.desc ? `<span class="cell-sub">${esc(o.desc)}</span>` : ''}</span>
          </div>`).join('')}
        </div>
        <button class="form-input" data-cancel style="margin-top:12px;text-align:center;background:#2c2c2e">取消</button>
      </div>`;
      const h = openOverlay(ov, () => { h.close(); resolve(-1); });
      ov.addEventListener('click', (e) => {
        const cell = e.target.closest('[data-i]');
        if (cell) { h.close(); resolve(+cell.dataset.i); }
        else if (e.target.closest('[data-cancel]') || e.target === ov) { h.close(); resolve(-1); }
      });
      // 选项是 div，键盘用户按 Enter / 空格也要能选中
      ov.addEventListener('keydown', (e) => {
        const cell = e.target.closest?.('[data-i]');
        if (cell && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); h.close(); resolve(+cell.dataset.i); }
      });
      h.focusFirst();
    });
  },
  sheet(title, opts) {
    // opts: [{label, value, icon, onClick}] 或自定义 html
    return new Promise((resolve) => {
      const ov = document.createElement('div');
      ov.className = 'overlay';
      ov.innerHTML = `<div class="panel">
        ${title ? `<h3>${esc(title)}</h3>` : ''}
        <div class="opts">
          ${opts.map((o, i) => `<div class="cell" data-i="${i}" role="button" tabindex="0">
            ${o.icon ? `<span class="ci" style="background:${safeColor(o.color)}">${esc(o.icon)}</span>` : ''}
            <span class="cl">${esc(o.label)}</span>${o.value ? `<span class="cv">${esc(o.value)}</span>` : ''}
          </div>`).join('')}
        </div>
        <button class="form-input" data-cancel style="margin-top:12px;text-align:center;background:#2c2c2e">取消</button>
      </div>`;
      const h = openOverlay(ov, () => { h.close(); resolve(null); });
      ov.addEventListener('click', (e) => {
        const cell = e.target.closest('[data-i]');
        if (cell) { h.close(); resolve(opts[+cell.dataset.i]); }
        else if (e.target.closest('[data-cancel]') || e.target === ov) { h.close(); resolve(null); }
      });
      ov.addEventListener('keydown', (e) => {
        const cell = e.target.closest?.('[data-i]');
        if (cell && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); h.close(); resolve(opts[+cell.dataset.i]); }
      });
      h.focusFirst();
    });
  },
  prompt(title, placeholder = '', value = '', type = 'text') {
    return new Promise((resolve) => {
      const ov = document.createElement('div');
      ov.className = 'overlay';
      ov.innerHTML = `<div class="panel">
        <h3>${esc(title)}</h3>
        <input class="form-input" id="ovp-input" type="${esc(type)}" placeholder="${esc(placeholder)}" value="${esc(value)}">
        <div style="display:flex;gap:10px;margin-top:14px">
          <button class="form-input" data-r="0" style="flex:1;text-align:center;background:#3a3a3c">取消</button>
          <button class="form-input" data-r="1" style="flex:1;text-align:center;background:#0a84ff;color:#fff;border-radius:12px">确定</button>
        </div></div>`;
      const input = ov.querySelector('#ovp-input');
      // Esc 取消（返回 null）、Enter 确定，语义与按钮一致
      const h = openOverlay(ov, () => { h.close(); resolve(null); });
      ov.addEventListener('click', (e) => {
        const r = e.target.dataset.r;
        if (r !== undefined) { h.close(); resolve(r === '1' ? input.value.trim() : null); }
        else if (e.target === ov) { h.close(); resolve(null); }
      });
      ov.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); h.close(); resolve(input.value.trim()); }
      });
      h.focusFirst(input);
    });
  },
};

// ---------- 自动同步接线 ----------
// 任何一次 save（记账/改账/删账/改设置）都排一次延迟上传；拉到新数据则刷新列表页。
// runAutoSync 内部的 save 不会再次触发排程（busy 标志拦住），所以不会自激循环。
subscribe(() => scheduleAutoPush());
// 写不进 localStorage（配额满）时必须喊出来：内存里的 state 已经改了但没落盘，
// 用户看到的还是"已记一笔"，刷新就没了 —— 静默吞掉等于骗人
onSaveError(() => {
  UI.toast('存储空间不足，本次改动没能保存！请到「备份与同步」导出备份', 6000);
});
document.addEventListener('visibilitychange', () => { if (!document.hidden) runAutoSync(); });
onAutoSync(({ added }) => {
  if (added <= 0) return;
  const { route } = parseHash();
  // 只在列表类 Tab 页重渲染 —— 记一笔页面重绘会清掉用户正在输入的内容
  if (isTab(route)) render();
  UI.toast(`云端同步了 ${added} 笔新账单`);
});

// ---------- Service Worker ----------
// 只在 https / localhost 下注册（安全上下文要求，和 crypto.subtle 一致）。
// 注意 sw.js 是 ES module worker（它 import 了 js/modules.js），注册时必须带 type:'module'。
function registerSW() {
  try {
    if (!('serviceWorker' in navigator)) return;
    const host = location.hostname;
    if (location.protocol !== 'https:' && host !== 'localhost' && host !== '127.0.0.1') return;
    navigator.serviceWorker.register('./sw.js', { type: 'module' }).then((reg) => {
      reg.addEventListener('updatefound', () => {
        const nw = reg.installing;
        if (!nw) return;
        nw.addEventListener('statechange', () => {
          // controller 存在说明页面上已有旧 SW 在跑 —— 这次是真更新；首次安装不打扰用户
          if (nw.state === 'installed' && navigator.serviceWorker.controller) {
            UI.confirm('发现新版本，是否立即更新？', '更新').then((yes) => {
              if (!yes) return;
              nw.postMessage('SKIP_WAITING');
              location.reload();
            });
          }
        });
      });
    }).catch(() => {});   // 注册失败不拖累主流程：离线缓存是增强，不是依赖
  } catch {}
}

// 启动
load();
restorePassword();
registerSW();
import('./pages/index.js').then((m) => {
  registerPages(m.pages);
  const st = load();
  document.body.classList.toggle('light', st.settings.theme === 'light');
  if (!location.hash) location.hash = `#/${st.settings.startPage === 'record' ? 'record' : 'home'}`; // 秒开模式
  render();
  setTimeout(runAutoSync, 2000); // 进 App 先悄悄对齐一次
});
