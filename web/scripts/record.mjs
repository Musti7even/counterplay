// Deterministic video recorder: builds a snapshot of the app, serves it, steps match time frame by frame
// (no realtime clock), screenshots each frame in headless Chrome (swiftshader) and pipes JPEGs into ffmpeg.
//   npm run record -- --url '?director=whatif' --out shots/whatif.mp4
//   npm run record -- --url '?match=match&cam=broadcast' --from 60 --to 72 --fps 30 --out shots/x.mp4
// --from/--to default to the director script's window. Slow-mo cues produce more frames per match second.
import puppeteer from 'puppeteer-core';
import { spawn, execFileSync } from 'node:child_process';
import { existsSync, readdirSync, mkdirSync, renameSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const WEB = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const { values: a } = parseArgs({ options: {
  url: { type: 'string', default: '?match=match' }, from: { type: 'string' }, to: { type: 'string' },
  fps: { type: 'string', default: '30' }, out: { type: 'string', default: 'shots/out.mp4' },
  width: { type: 'string', default: '1920' }, height: { type: 'string', default: '1080' },
  crf: { type: 'string', default: '18' }, base: { type: 'string' },
} });
const fps = +a.fps, W = +a.width, H = +a.height, out = resolve(WEB, a.out);

function findChrome() {
  if (process.env.CHROME) return process.env.CHROME;
  for (const root of [resolve(WEB, '../../.tools/pl-browsers'), '/tmp/pl-browsers']) {
    const dir = `${root}/chrome-headless-shell`;
    if (!existsSync(dir)) continue;
    for (const v of readdirSync(dir)) { // skips .metadata etc.
      const p = `${dir}/${v}/chrome-headless-shell-linux64/chrome-headless-shell`;
      if (existsSync(p)) return p;
    }
  }
  throw new Error('no headless chrome: npx @puppeteer/browsers install chrome-headless-shell@stable --path ../../.tools/pl-browsers');
}

// frozen build so edits to src/ during a long render can't hot-reload mid-take
async function serve() {
  if (a.base) return { base: a.base, stop() {} };
  const dist = `/tmp/pl-rec-${process.pid}`;
  execFileSync(resolve(WEB, 'node_modules/.bin/vite'), ['build', '--outDir', dist, '--emptyOutDir', '--logLevel', 'error'], { cwd: WEB, stdio: 'inherit' });
  const child = spawn(resolve(WEB, 'node_modules/.bin/vite'), ['preview', '--outDir', dist, '--port', '0', '--strictPort', 'false'], { cwd: WEB });
  const base = await new Promise((ok, fail) => {
    let buf = '';
    child.stdout.on('data', (d) => { buf += d; const m = buf.replace(/\x1b\[[0-9;]*m/g, '').match(/Local:\s+(http:\/\/\S+?)\/?\s/); if (m) ok(m[1]); });
    child.on('exit', (c) => fail(new Error(`vite preview exited ${c}: ${buf}`)));
  });
  return { base, stop: () => { child.kill(); try { execFileSync('rm', ['-rf', dist]); } catch {} } };
}

const srv = await serve();
mkdirSync(dirname(out), { recursive: true });
const ff = spawn('/usr/bin/ffmpeg', ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(fps), '-c:v', 'mjpeg', '-i', '-',
  '-vf', `scale=${W}:${H}:out_range=tv,format=yuv420p`, '-c:v', 'libx264', '-preset', 'medium', '-crf', a.crf, '-pix_fmt', 'yuv420p', '-movflags', '+faststart', out],
  { stdio: ['pipe', 'inherit', 'inherit'] });
const browser = await puppeteer.launch({
  executablePath: findChrome(), headless: true, protocolTimeout: 600000,
  args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', `--window-size=${W},${H}`],
});
try {
  const page = await browser.newPage();
  await page.setViewport({ width: W, height: H, deviceScaleFactor: 1 });
  page.on('pageerror', (e) => console.error('pageerror', e.message));
  const qs = a.url.startsWith('?') ? a.url : `?${a.url}`;
  await page.goto(`${srv.base}/${qs}&capture=1`, { waitUntil: 'load' });
  await page.waitForFunction('window.__ready === true || document.getElementById("error").textContent', { timeout: 300000, polling: 200 });
  const err = await page.evaluate(() => document.getElementById('error').textContent);
  if (err) throw new Error(err);
  const win = await page.evaluate(() => window.demo.window);
  const from = a.from != null ? +a.from : win?.[0] ?? 0, to = a.to != null ? +a.to : win?.[1] ?? from + 10;
  await page.evaluate((t) => window.demo.seek(t), from);
  const cdp = await page.createCDPSession();
  const t0 = Date.now();
  let t = from, n = 0;
  const ts = []; // match time of every frame, to place voice clips
  while (t < to && n < fps * 600) {
    t = await page.evaluate((dt) => window.demo.step(dt), 1 / fps);
    ts.push(t);
    const { data } = await cdp.send('Page.captureScreenshot', { format: 'jpeg', quality: 93, optimizeForSpeed: true });
    if (!ff.stdin.write(Buffer.from(data, 'base64'))) await new Promise((r) => ff.stdin.once('drain', r));
    if (++n % fps === 0) console.log(`frame ${n}  match t=${t.toFixed(2)}/${to}  ${((Date.now() - t0) / n / 1000).toFixed(2)} s/frame`);
  }
  ff.stdin.end();
  await new Promise((r) => ff.on('exit', r));
  // voice: each clip starts on the first frame whose match time reaches its t (slow-mo aware); mixed into one AAC track
  const clips = ((await page.evaluate(() => window.demo.audio ?? [])) || [])
    .map((c) => ({ ...c, file: resolve(WEB, '..', c.url.replace(/^\//, '')), frame: ts.findIndex((x) => x >= c.t) }))
    .filter((c) => c.frame >= 0 && c.t >= from - 0.01 && existsSync(c.file));
  if (clips.length) {
    const tmp = out.replace(/\.mp4$/, '.video.mp4');
    renameSync(out, tmp);
    const inputs = clips.flatMap((c) => ['-i', c.file]);
    const delays = clips.map((c, i) => `[${i + 1}:a]adelay=${Math.round((c.frame / fps) * 1000)}:all=1[a${i}]`).join(';');
    const mix = `${delays};${clips.map((_, i) => `[a${i}]`).join('')}amix=inputs=${clips.length}:normalize=0:duration=longest[a]`;
    execFileSync('/usr/bin/ffmpeg', ['-y', '-loglevel', 'error', '-i', tmp, ...inputs, '-filter_complex', mix, '-map', '0:v', '-map', '[a]',
      '-c:v', 'copy', '-c:a', 'aac', '-b:a', '160k', '-t', String(n / fps), '-movflags', '+faststart', out]);
    rmSync(tmp);
    console.log(`muxed ${clips.length} voice clip(s): ${clips.map((c) => `${c.t}s@${(c.frame / fps).toFixed(2)}s`).join(', ')}`);
  }
  console.log(`wrote ${out}: ${n} frames, ${(n / fps).toFixed(1)} s @ ${fps} fps (match ${from}→${to})`);
} finally {
  await browser.close();
  srv.stop();
}
