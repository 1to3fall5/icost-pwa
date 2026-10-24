// 统一测试入口：npm test
//
// 自动发现 scripts/ 下的测试脚本并依次跑，新增 *-test.mjs 不用改这里。
// 只认两类：
//   *-test.mjs   标准测试
//   smoke.mjs    冒烟测试（历史命名，没有 -test 后缀）
//
// 注意：不能改成「跑所有 .mjs」—— scripts/ 下还放着生成脚本（如 build-preview.mjs），
// 它们不是测试、有副作用（会写 docs/），一旦被当测试跑就会让 CI 假失败、部署被跳过。
// 新增非测试脚本请放进 scripts/tools/ 或保持非 -test 命名。
import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const DIR = dirname(fileURLToPath(import.meta.url));
const SKIP = new Set(['run-tests.mjs', 'sync-e2e.mjs']);   // sync-e2e 需要真实 GH_TOKEN，只能本地跑
const files = readdirSync(DIR)
  .filter((f) => (f.endsWith('-test.mjs') || f === 'smoke.mjs') && !SKIP.has(f))
  .sort();

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
