/* iCost 复刻 · Service Worker（零依赖手写，ES module worker）
   策略：HTML network-first；静态资源 stale-while-revalidate；离线兜底 index.html

   预缓存清单来自 js/modules.js —— 不要在这里再抄一份列表，
   否则新增模块会两边不同步（离线时 404）。module-test.mjs 会校验一致性。 */
import { PRECACHE } from './js/modules.js';

const VERSION = 'v1.24.0';
const CACHE = `icost-${VERSION}`;

self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await cache.addAll(PRECACHE.map((u) => new Request(u, { cache: 'reload' })));
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
  // 应用代码（js / css）：network-first —— SWR 会让用户刷新后仍拿到旧 bundle，
  // 表现为"新功能没出现"。离线或断网时再回退缓存，保证 PWA 仍可启动。
  if (url.pathname.endsWith('.js') || url.pathname.endsWith('.css')) {
    e.respondWith((async () => {
      const cache = await caches.open(CACHE);
      try {
        const fresh = await fetch(req);
        if (fresh && fresh.status === 200) cache.put(req, fresh.clone());
        return fresh;
      } catch {
        return (await cache.match(req)) || (await fetch(req));
      }
    })());
    return;
  }
  // 其余静态资源（图标等）: SWR
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
