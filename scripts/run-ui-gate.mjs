import {spawnSync} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const steps = [
  ['npm', ['run', 'typecheck']],
  ['npm', ['run', 'lint']],
  ['node', ['scripts/ui-gate.mjs']],
  ['npm', ['test']],
  ['npm', ['run', 'test:ui']],
  ['npm', ['run', 'build']],
  ['node', ['scripts/ui-gate.mjs', '--dist']],
];

for (const [cmd, args] of steps) {
  console.log(`\n>> ${cmd} ${args.join(' ')}`);
  const result = spawnSync(cmd, args, {cwd: root, stdio: 'inherit', shell: true, env: process.env});
  if (result.status !== 0) process.exit(result.status ?? 1);
}
console.log('\nUI gate (without e2e) passed. Run npm run e2e separately.');
