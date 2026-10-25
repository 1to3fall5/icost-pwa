// 统一测试入口：npm test
//
// 自动发现 scripts/ 下的测试脚本并依次跑，新增测试文件不用改这里。
// 只认 *-test.mjs 与 smoke.mjs —— 同目录里的构建 / 打包脚本（build-preview.mjs 等）
// 不是测试，跑它们会顺带往 docs/ 写文件，CI 上因为目录不存在直接失败。
// 另外排除：
//   run-tests.mjs  自己
//   sync-e2e.mjs   需要真实 GH_TOKEN 且会联网建 Gist，只能在本地手动跑
import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const DIR = dirname(fileURLToPath(import.meta.url));
const SKIP = new Set(['run-tests.mjs', 'sync-e2e.mjs']);
const isTest = (f) => f.endsWith('-test.mjs') || f === 'smoke.mjs';
const files = readdirSync(DIR).filter((f) => f.endsWith('.mjs') && !SKIP.has(f) && isTest(f)).sort();

const failed = [];
for (const f of files) {
  console.log(`\n──────────── ${f} ────────────`);
  const r = spawnSync(process.execPath, [join(DIR, f)], { stdio: 'inherit' });
  if (r.status !== 0) failed.push(f);
}

console.log('\n' + '='.repeat(46));
if (failed.length) {
  console.log(`FAILED (${failed.length}/${files.length}): ${failed.join(', ')}`);
  process.exit(1);
}
console.log(`全部通过 —— ${files.length} 个测试脚本`);
