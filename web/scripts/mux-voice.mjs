// Add commentary voice to an already-rendered clip, without re-rendering video.
//   node scripts/mux-voice.mjs shots/control.mp4 [--run fork-step_up.casual.en.killtactician]
// Uses the clip's sidecar <clip>.frames.json (match time per frame, written by record.mjs) and
// data/audio/<run>/voice.json [{t, file}]. Each line starts on the first frame whose match time reaches t
// (slow-mo aware, same rule as the recorder). The run is inferred from the clip URL (cues=/commentary=/quad) unless given.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, renameSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const WEB = resolve(dirname(fileURLToPath(import.meta.url)), '..'), DATA = resolve(WEB, '../data');
const clip = resolve(WEB, process.argv[2] ?? ''), runArg = process.argv.indexOf('--run');
const side = clip.replace(/\.mp4$/, '.frames.json');
if (!existsSync(clip) || !existsSync(side)) { console.error(`need ${clip} and ${side} (render with npm run record)`); process.exit(1); }
const { url, fps, ts } = JSON.parse(readFileSync(side, 'utf8'));
const q = new URLSearchParams(url.replace(/^\?/, ''));
const run = runArg > 0 ? process.argv[runArg + 1]
  : (q.get('cues') ?? q.get('commentary') ?? '').match(/([^/]+)\.(cues|commentary)\.json$/)?.[1]
  ?? (q.get('view') === 'quad' ? (q.get('quad') ?? 'match.casual.en').split(',')[0] : null);
const manifest = run && resolve(DATA, 'audio', run, 'voice.json');
if (!manifest || !existsSync(manifest)) { console.log(`no voice for ${run ?? '(no agent run in URL)'}; clip left silent`); process.exit(0); }
const lines = JSON.parse(readFileSync(manifest, 'utf8'))
  .map((l) => ({ ...l, file: resolve(DATA, 'audio', run, l.file), frame: ts.findIndex((x) => x >= l.t) }))
  .filter((l) => l.frame >= 0 && existsSync(l.file));
if (!lines.length) { console.log('no voice line falls inside this clip'); process.exit(0); }
const tmp = clip.replace(/\.mp4$/, '.novoice.mp4');
renameSync(clip, tmp);
const delays = lines.map((l, i) => `[${i + 1}:a]adelay=${Math.round((l.frame / fps) * 1000)}:all=1[a${i}]`).join(';');
execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', tmp, ...lines.flatMap((l) => ['-i', l.file]),
  '-filter_complex', `${delays};${lines.map((_, i) => `[a${i}]`).join('')}amix=inputs=${lines.length}:normalize=0:duration=longest[a]`,
  '-map', '0:v', '-map', '[a]', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '160k', '-t', String(ts.length / fps), '-movflags', '+faststart', clip]);
rmSync(tmp);
console.log(`${clip}: muxed ${lines.length} voice line(s) from ${run}`);
