/* iCost 复刻 · Service Worker（零依赖手写）
   策略：HTML network-first；静态资源 stale-while-revalidate；离线兜底 index.html */
const VERSION = 'v1.4.0';
const CACHE = `icost-${VERSION}`;
const SHELL = [
  './',
  './index.html',
  './manifest.json',
  './css/style.css',
  './js/app.js', './js/store.js', './js/icons.js', './js/charts.js', './js/sync.js',
  './assets/icon-192.png', './assets/icon-512.png', './assets/icon-maskable-512.png', './assets/icon-180.png',
];
const PAGE_MODULES = [
  'home', 'asset', 'save', 'stats', 'record', 'calendar', 'search', 'detail', 'settings',
  'category', 'budget', 'books', 'templates', 'recurring', 'claim', 'loan',
  'assetdetail', 'savedetail', 'statsdetail', 'importexport', 'more',
].map((p) => `./js/pages/${p}.js`);
PAGE_MODULES.push('./js/pages/index.js'); // 路由注册表（app.js 动态 import）

self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await cache.addAll([...SHELL, ...PAGE_MODULES].map((u) => new Request(u, { cache: 'reload' })));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;

  // HTML: network-first
  if (req.mode === 'navigate' || url.pathname.endsWith('.html')) {
    e.respondWith((async () => {
      try {
        const fresh = await fetch(req);
        const cache = await caches.open(CACHE);
        cache.put('./index.html', fresh.clone());
        return fresh;
      } catch {
        return (await caches.match('./index.html')) || (await caches.match('./')) || Response.error();
      }
    })());
    return;
  }
  // 静态资源: SWR
  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const cached = await cache.match(req);
    const network = fetch(req).then((res) => {
      if (res && res.status === 200) cache.put(req, res.clone());
      return res;
    }).catch(() => cached);
    return cached || network;
  })());
});

// 用户确认式更新
self.addEventListener('message', (e) => {
  if (e.data === 'SKIP_WAITING') self.skipWaiting();
});
