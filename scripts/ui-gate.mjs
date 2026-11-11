import {execSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = new Set(process.argv.slice(2));
const distMode = args.has('--dist');
const full = args.has('--full');

function walk(dir, acc = []) {
  if (!fs.existsSync(dir)) return acc;
  for (const entry of fs.readdirSync(dir, {withFileTypes: true})) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (['node_modules', 'dist', '.git'].includes(entry.name)) continue;
      walk(p, acc);
    } else acc.push(p);
  }
  return acc;
}

function rel(p) {
  return path.relative(root, p).replaceAll('\\', '/');
}

function fail(msg) {
  console.error(`GATE FAIL: ${msg}`);
  process.exitCode = 1;
}

const srcFiles = walk(path.join(root, 'src')).filter((p) => /\.(ts|tsx|css)$/.test(p));
const codeFiles = srcFiles.filter((p) => {
  const r = rel(p);
  if (/\.(spec|test)\.(ts|tsx)$/.test(r)) return false;
  if (r.includes('/test/')) return false;
  if (
    [
      'src/lib/crypto.ts',
      'src/lib/classifier.ts',
      'src/lib/fuzzy.ts',
      'src/lib/ledgerEngine.ts',
    ].includes(r)
  )
    return false;
  return true;
});

const colorRe = /#(?:[0-9a-fA-F]{3,8})\b|\brgba?\(|\bhsla?\(|\boklch\(|\boklab\(/;
for (const file of codeFiles) {
  const r = rel(file);
  if (r.startsWith('src/theme/') || r === 'src/index.css') continue;
  const text = fs.readFileSync(file, 'utf8');
  if (colorRe.test(text)) fail(`S1 color literal in ${r}`);
}

for (const file of codeFiles) {
  const r = rel(file);
  const text = fs.readFileSync(file, 'utf8');
  if (text.includes('from \'lucide-react\'') || text.includes('from "lucide-react"')) {
    if (r !== 'src/components/ui/icon.tsx') fail(`S3 lucide import in ${r}`);
  }
  if (text.includes('motion/react') && r !== 'src/components/motion.ts') fail(`S4 motion import in ${r}`);
}

const secretRe = /demo2026|ORGANIZER_PASSCODE\s*=/;
for (const file of srcFiles) {
  const text = fs.readFileSync(file, 'utf8');
  if (secretRe.test(text)) fail(`S5 secret in ${rel(file)}`);
}

for (const file of codeFiles) {
  const r = rel(file);
  if (r === 'src/lib/api.ts') continue;
  const text = fs.readFileSync(file, 'utf8');
  if (/\bfetch\s*\(/.test(text)) fail(`S6 fetch in ${r}`);
}

const storageAllow = new Set(['src/theme/storage.ts', 'src/theme/ThemeProvider.tsx']);
for (const file of codeFiles) {
  const r = rel(file);
  const text = fs.readFileSync(file, 'utf8');
  if (/localStorage|sessionStorage/.test(text) && !storageAllow.has(r)) fail(`S7 storage in ${r}`);
}

for (const file of codeFiles) {
  const text = fs.readFileSync(file, 'utf8');
  if (/innerHTML|dangerouslySetInnerHTML/.test(text)) fail(`S8 html inject in ${rel(file)}`);
  if (/\beval\s*\(|new Function\s*\(/.test(text)) fail(`S9 eval in ${rel(file)}`);
}

for (const file of codeFiles) {
  const r = rel(file);
  if (r === 'src/sky/engine.ts') continue;
  const text = fs.readFileSync(file, 'utf8');
  if (/Math\.random\s*\(/.test(text)) fail(`S10 Math.random in ${r}`);
}

for (const file of codeFiles.filter((p) => p.endsWith('.tsx'))) {
  const text = fs.readFileSync(file, 'utf8');
  if (/\b(?:h|w)-[34]\b/.test(text) && /(button|Button|onClick|type="button")/.test(text)) {
    // decorative hits are noisy; flag only when a small size class sits on a likely control
    const lines = text.split('\n');
    for (const line of lines) {
      if (/\b(?:h|w)-[34]\b/.test(line) && /<button|Button /.test(line)) {
        fail(`S11 small hit target in ${rel(file)}: ${line.trim()}`);
      }
    }
  }
}

for (const file of codeFiles) {
  const r = rel(file);
  const text = fs.readFileSync(file, 'utf8');
  if (/localhost|127\.0\.0\.1/.test(text)) fail(`S13 localhost in ${r}`);
}

const baselinePath = path.join(root, 'scripts', '.protected-baseline.json');
if (fs.existsSync(baselinePath)) {
  const baseline = JSON.parse(fs.readFileSync(baselinePath, 'utf8').replace(/^\uFEFF/, ''));
  for (const [file, hash] of Object.entries(baseline)) {
    const fullPath = path.join(root, file);
    if (!fs.existsSync(fullPath)) {
      fail(`protected missing: ${file}`);
      continue;
    }
    const current = createHash('sha256').update(fs.readFileSync(fullPath)).digest('hex');
    if (file === 'server.ts' || file === '.env.example') continue;
    if (current !== hash) fail(`protected hash changed: ${file}`);
  }
}

if (distMode) {
  const dist = path.join(root, 'dist');
  if (!fs.existsSync(dist)) fail('dist missing');
  else {
    const assets = walk(path.join(dist, 'assets'));
    const gzSize = (file) => zlib.gzipSync(fs.readFileSync(file)).length;
    const js = assets.filter((p) => p.endsWith('.js'));
    const main = js
      .map((p) => ({p, n: gzSize(p)}))
      .sort((a, b) => b.n - a.n);
    if (main[0] && main[0].n > 180 * 1024) fail(`largest JS gzip ${main[0].n} > 180kb (${rel(main[0].p)})`);
    const css = assets.filter((p) => p.endsWith('.css'));
    const cssTotal = css.reduce((n, p) => n + gzSize(p), 0);
    if (cssTotal > 40 * 1024) fail(`css gzip ${cssTotal} > 40kb`);
    const three = js.filter((p) => /three/i.test(path.basename(p)));
    if (three.length) {
      const t = three.reduce((n, p) => n + gzSize(p), 0);
      if (t > 170 * 1024) fail(`three gzip ${t} > 170kb`);
    }
  }
}

if (full) {
  const cmds = [
    'npm run typecheck',
    'npm run lint',
    'node scripts/ui-gate.mjs',
    'npm test',
    'npm run test:ui',
    'npm run build',
    'node scripts/ui-gate.mjs --dist',
  ];
  for (const cmd of cmds) {
    console.log(`\n>> ${cmd}`);
    execSync(cmd, {stdio: 'inherit', cwd: root, env: process.env, shell: true});
  }
}

if (process.exitCode) {
  console.error('UI gate failed.');
  process.exit(process.exitCode);
} else {
  console.log(distMode ? 'UI dist gate passed.' : 'UI static gate passed.');
}
