// Node 冒烟测试：stub 最小 DOM，加载全部页面模块并渲染
const noop = () => {};
const el = () => ({
  style: {}, classList: { add: noop, remove: noop, toggle: noop, contains: () => false },
  innerHTML: '', textContent: '', appendChild: noop, remove: noop, addEventListener: noop,
  querySelector: () => el(), querySelectorAll: () => [], dataset: {}, closest: () => null,
  setAttribute: noop, focus: noop, clientWidth: 300, parentElement: { clientWidth: 300 },
  getContext: () => new Proxy({}, { get: (t, k) => (k === 'measureText' ? () => ({ width: 10 }) : typeof k === 'string' ? noop : undefined), set: () => true }),
});
globalThis.document = {
  getElementById: () => el(), createElement: () => el(),
  querySelector: () => null, querySelectorAll: () => [],
  addEventListener: noop, body: el(), head: el(),
};
globalThis.window = { addEventListener: noop, devicePixelRatio: 1, location: { hash: '' }, scrollTo: noop, history: { length: 1 } };
globalThis.localStorage = { getItem: () => null, setItem: noop, removeItem: noop };
globalThis.location = { hash: '#/home', href: 'http://x/index.html' };
globalThis.history = { length: 1, back: noop };
globalThis.requestAnimationFrame = (f) => f();
globalThis.Node = class Node {};
globalThis.HTMLElement = class HTMLElement {};

// 相对本脚本定位 js/pages/ —— 硬编码绝对路径会让测试在别的机器上直接挂掉
const base = new URL('../js/pages/', import.meta.url).href;
// 路由表直接取 modules.js 的页面清单（index 是路由注册表不是页面），新增页面自动被冒烟覆盖
const { PAGE_NAMES } = await import(new URL('../js/modules.js', import.meta.url).href);
const routes = PAGE_NAMES.filter((r) => r !== 'index');
const argOf = { detail: { id: 'x' }, savedetail: { mode: 'fixed' } };
let fail = 0;
for (const r of routes) {
  try {
    const m = await import(base + r + '.js');
    const p = m.default;
    if (!p || typeof p.render !== 'function') throw new Error('契约缺失: render');
    const html = await p.render(argOf[r] || {});
    if (typeof html !== 'string') throw new Error('render 输出异常');
    if (p.mount) { try { p.mount(el(), {}); } catch (e) { throw new Error('mount: ' + e.message); } }
    console.log(`OK  ${r.padEnd(13)} ${(html.length / 1024).toFixed(1)}KB  title="${p.title}"`);
  } catch (e) {
    fail++;
    console.log(`FAIL ${r}: ${e.message}\n    ${String(e.stack).split('\n')[1] || ''}`);
  }
}
process.exit(fail ? 1 : 0);
