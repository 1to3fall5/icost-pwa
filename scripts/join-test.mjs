// 一键接入链接的往返测试：生成链接 -> 走 URL 解析 -> 解回 token / gistId
// 嵌套编码（btoa + encodeURIComponent + URLSearchParams）最容易在这里出错
import { writeSync } from 'node:fs';

const mem = new Map();
globalThis.localStorage = {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => mem.set(k, String(v)),
  removeItem: (k) => mem.delete(k),
};
globalThis.document = {
  getElementById: () => null, createElement: () => ({}),
  querySelector: () => null, querySelectorAll: () => [],
  addEventListener: () => {}, body: {}, head: {},
};
globalThis.window = { addEventListener: () => {} };
globalThis.location = { origin: 'https://1to3fall5.github.io', pathname: '/icost-pwa/', hash: '' };

let pass = 0; let fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; writeSync(1, 'PASS ' + name + '\n'); }
  else { fail++; writeSync(1, 'FAIL ' + name + (extra ? '  -> ' + extra : '') + '\n'); }
};

const { parseCode } = await import('../js/pages/syncjoin.js');

// 与 importexport.js 里 joinLink() 完全一致的生成逻辑
const TOKEN = 'ghp_abcdefghijklmnopqrstuvwxyz0123456789';
const GIST = 'a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6';
const code = 'icost1.' + btoa(encodeURIComponent(TOKEN + '|' + GIST));
const link = location.origin + location.pathname + '#/syncjoin?c=' + encodeURIComponent(code);

ok('链接指向 syncjoin 路由', link.includes('#/syncjoin?c='), link);

// 模拟浏览器打开链接：hash -> URLSearchParams -> parseCode
const hash = link.split('#')[1];                 // syncjoin?c=xxx
const qs = hash.split('?')[1];
const got = new URLSearchParams(qs).get('c');
ok('URLSearchParams 取回的码与生成一致', got === code, `${got} vs ${code}`);

const pair = parseCode(got);
ok('解出 token 正确', pair.token === TOKEN, pair.token);
ok('解出 gistId 正确', pair.gistId === GIST, pair.gistId);

// 坏输入必须抛错，而不是静默配进一个残缺的 token
let threw = false;
try { parseCode('icost1.' + btoa(encodeURIComponent('onlytoken'))); } catch { threw = true; }
ok('残缺同步码会报错', threw);

threw = false;
try { parseCode('not-a-code'); } catch { threw = true; }
ok('乱码会报错', threw);

writeSync(1, `\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
