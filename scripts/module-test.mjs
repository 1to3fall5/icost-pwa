// 校验 js/modules.js 的清单与磁盘实际文件一致
// sw.js 和 bundle.py 都以它为唯一数据源 —— 清单漏了新模块，离线时就是 404，
// 而且本地开发（network-first）看不出来，只有断网才炸。所以必须靠测试拦住。
import { readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const { JS_CORE, PAGE_NAMES, SHELL_EXTRA } = await import(new URL('../js/modules.js', import.meta.url).href);

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log('OK   ' + name); }
  else { fail++; console.log('FAIL ' + name + (extra ? ' — ' + extra : '')); }
};

const rel = (p) => join(ROOT, p.replace(/^\.\//, ''));

// 1. 清单里的每一项都真实存在
JS_CORE.forEach((m) => ok(`核心模块存在 ${m}`, existsSync(rel(m))));
SHELL_EXTRA.forEach((m) => {
  if (m === './') return;                       // 目录本身，跳过
  ok(`离线资源存在 ${m}`, existsSync(rel(m)));
});
PAGE_NAMES.forEach((p) => ok(`页面模块存在 pages/${p}.js`, existsSync(join(ROOT, 'js/pages', p + '.js'))));

// 2. 反向：磁盘上有但清单里没有的（新增页面忘记登记，就是这一条拦）
const onDisk = readdirSync(join(ROOT, 'js/pages')).filter((f) => f.endsWith('.js')).map((f) => f.slice(0, -3));
const missing = onDisk.filter((f) => !PAGE_NAMES.includes(f));
ok('js/pages 下没有漏登记的模块', missing.length === 0, missing.join(', '));

const gone = PAGE_NAMES.filter((p) => !onDisk.includes(p));
ok('清单里没有已删除的模块', gone.length === 0, gone.join(', '));

// 3. 无重复（重复会让 sw 的 addAll 与 bundle 的注册表出问题）
const dup = PAGE_NAMES.filter((p, i) => PAGE_NAMES.indexOf(p) !== i);
ok('页面清单无重复', dup.length === 0, dup.join(', '));

console.log(`\n通过 ${pass} / 失败 ${fail}`);
process.exit(fail ? 1 : 0);
