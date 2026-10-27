// Render every clip the demo cut needs, then assemble shots/demo-v0.mp4.
//   npm run record:all                      # all clips + assemble
//   npm run record:all -- --only lens,quad  # subset (skips assemble unless --assemble)
//   npm run record:all -- --quick           # 0.2 s smoke test per clip, no assemble
//   npm run record:all -- --jobs 2          # render two clips at once (worth it when one render can't saturate the machine)
// Extra flags (--chrome <path>, --gpu, --no-gpu) are passed through to scripts/record.mjs.
import { spawn, spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const WEB = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CLIPS = {
  coldopen: ['--url', '?director=coldopen'],
  whatif: ['--url', '?director=whatif'],
  lens: ['--url', '?director=lens'],
  quad: ['--url', '?view=quad', '--from', '60', '--to', '72'],
  control: ['--url', '?cues=data/fork-step_up.casual.en.killtactician.cues.json&control=1&controlAt=62-70'],
};
const QUICK_FROM = { coldopen: 68, whatif: 66, lens: 62, quad: 63, control: 66 };

const argv = process.argv.slice(2), flag = (f) => argv.includes(f);
const value = (f) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : undefined; };
const only = value('--only')?.split(',');
const quick = flag('--quick');
const pass = [];
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '--chrome') pass.push('--chrome', argv[++i]);
  else if (argv[i] === '--gpu' || argv[i] === '--no-gpu') pass.push(argv[i]);
}

const run = (cmd, args) => {
  console.log(`\n$ ${cmd} ${args.join(' ')}`);
  const r = spawnSync(cmd, args, { cwd: WEB, stdio: 'inherit' });
  if (r.status !== 0) { console.error(`failed: ${cmd} (exit ${r.status})`); process.exit(r.status ?? 1); }
};

const t0 = Date.now(), jobs = Math.max(1, +(value('--jobs') ?? 1));
// longest clips first so a parallel pool finishes evenly
const ORDER = ['control', 'whatif', 'quad', 'lens', 'coldopen'];
const todo = ORDER.filter((n) => !only || only.includes(n));
const recordOne = (name) => new Promise((ok, fail) => {
  const extra = quick ? ['--from', String(QUICK_FROM[name]), '--to', String(QUICK_FROM[name] + 0.2)] : [];
  // later --from/--to win in parseArgs, so quick overrides the clip window
  const args = ['scripts/record.mjs', ...CLIPS[name], ...extra, ...pass, '--crf', '20', '--out', quick ? `shots/quick-${name}.mp4` : `shots/${name}.mp4`];
  console.log(`\n[${name}] node ${args.join(' ')}`);
  const c = spawn('node', args, { cwd: WEB });
  const tag = (d) => process.stdout.write(String(d).split('\n').filter(Boolean).map((l) => `[${name}] ${l}\n`).join(''));
  c.stdout.on('data', tag); c.stderr.on('data', tag);
  c.on('exit', (code) => (code === 0 ? ok() : fail(new Error(`${name} exited ${code}`))));
});
await Promise.all(Array.from({ length: Math.min(jobs, todo.length) }, async () => { while (todo.length) await recordOne(todo.shift()); }))
  .catch((e) => { console.error(e.message); process.exit(1); });
if ((!only && !quick) || flag('--assemble')) run('bash', ['scripts/assemble.sh', value('--name') ?? 'demo-v1.mp4']);
console.log(`\nrecord:all done in ${((Date.now() - t0) / 60000).toFixed(1)} min`);
