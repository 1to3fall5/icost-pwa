// 统一测试入口：npm test
//
// 自动发现 scripts/ 下的 .mjs 测试脚本并依次跑，新增测试文件不用改这里。
// 排除：
//   run-tests.mjs  自己
//   sync-e2e.mjs   需要真实 GH_TOKEN 且会联网建 Gist，只能在本地手动跑
import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const DIR = dirname(fileURLToPath(import.meta.url));
const SKIP = new Set(['run-tests.mjs', 'sync-e2e.mjs']);
const files = readdirSync(DIR).filter((f) => f.endsWith('.mjs') && !SKIP.has(f)).sort();

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
