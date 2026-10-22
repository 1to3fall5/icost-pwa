// 一键接入链接的往返测试：生成链接 -> 走 URL 解析 -> 解回 gistId（以及旧版码里的 token）
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

const TOKEN = 'ghp_abcdefghijklmnopqrstuvwxyz0123456789';
const GIST = 'a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6';

// ---- 1. 新版码（v2）：只带 Gist 地址，不含 token ----
const code = 'icost2.' + btoa(encodeURIComponent(GIST));
const link = location.origin + location.pathname + '#/syncjoin?c=' + encodeURIComponent(code);

ok('链接指向 syncjoin 路由', link.includes('#/syncjoin?c='), link);
ok('新版链接里不含 token 明文', !link.includes(TOKEN) && !link.includes('ghp_'));

// 模拟浏览器打开链接：hash -> URLSearchParams -> parseCode
const hash = link.split('#')[1];                 // syncjoin?c=xxx
const qs = hash.split('?')[1];
const got = new URLSearchParams(qs).get('c');
ok('URLSearchParams 取回的码与生成一致', got === code, `${got} vs ${code}`);

const pair = parseCode(got);
ok('解出 gistId 正确', pair.gistId === GIST, pair.gistId);
ok('新版码解出的 token 为空（需用户手动填）', pair.token === '', JSON.stringify(pair.token));

// ---- 2. 旧版码（v1）：带 token，必须继续可用，否则老用户手里的码直接失效 ----
const legacy = 'icost1.' + btoa(encodeURIComponent(TOKEN + '|' + GIST));
const lp = parseCode(legacy);
ok('旧版码仍能解出 token', lp.token === TOKEN, lp.token);
ok('旧版码仍能解出 gistId', lp.gistId === GIST, lp.gistId);

// ---- 3. 坏输入必须抛错，而不是静默配进一个残缺的配置 ----
let threw = false;
try { parseCode('icost2.' + btoa(encodeURIComponent(''))); } catch { threw = true; }
ok('空内容的码会报错', threw);

threw = false;
try { parseCode('not-a-code'); } catch { threw = true; }
ok('乱码会报错', threw);

// 只有 token 没有 Gist 地址的旧码属残缺，应报错
threw = false;
try { parseCode('icost1.' + btoa(encodeURIComponent(TOKEN + '|'))); } catch { threw = true; }
ok('残缺的旧版码仍会报错', threw);

writeSync(1, `\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
