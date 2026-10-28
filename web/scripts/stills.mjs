// Frozen frames for the video (holds are cheaper as one frame + ffmpeg than hundreds of identical frames).
//   node scripts/stills.mjs spec.json      spec: [{ "url": "?...", "t": 66.0, "out": "shots/v2/s2a.png" }, ...]
// Same frozen build + capture mode as record.mjs; time is held at t while a few render steps let fades settle.
import puppeteer from 'puppeteer-core';
import { spawn, execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const WEB = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const spec = JSON.parse(readFileSync(resolve(process.argv[2]), 'utf8'));
const toolDir = resolve(WEB, '../../.tools/pl-browsers/chrome-headless-shell');
const CHROME = process.env.CHROME ?? readdirSync(toolDir).map((v) => `${toolDir}/${v}/chrome-headless-shell-linux64/chrome-headless-shell`).find(existsSync);

const dist = join(tmpdir(), `pl-stills-${process.pid}`);
execFileSync(resolve(WEB, 'node_modules/.bin/vite'), ['build', '--outDir', dist, '--emptyOutDir', '--logLevel', 'error'], { cwd: WEB, stdio: 'inherit' });
const prev = spawn(resolve(WEB, 'node_modules/.bin/vite'), ['preview', '--outDir', dist, '--port', '0', '--strictPort', 'false'], { cwd: WEB });
const base = await new Promise((ok) => { let b = ''; prev.stdout.on('data', (d) => { b += d; const m = b.replace(/\x1b\[[0-9;]*m/g, '').match(/Local:\s+(http:\/\/\S+?)\/?\s/); if (m) ok(m[1]); }); });
const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, protocolTimeout: 600000,
  args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--window-size=1920,1080'] });
try {
  for (const s of spec) {
    const out = resolve(WEB, s.out); mkdirSync(dirname(out), { recursive: true });
    const page = await browser.newPage();
    await page.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 1 });
    page.on('pageerror', (e) => console.error('pageerror', e.message));
    await page.goto(`${base}/${s.url}&capture=1`, { waitUntil: 'load' });
    await page.waitForFunction('window.__ready === true', { timeout: 300000, polling: 200 });
    await page.evaluate((t) => { window.demo.seek(t); window.demo.state.playing = false; }, s.t);
    for (let i = 0; i < 3; i++) await page.evaluate(() => window.demo.step(0.3)); // fades settle, time stays at t
    await page.screenshot({ path: out });
    console.log('wrote', s.out);
    await page.close();
  }
} finally { await browser.close(); prev.kill(); rmSync(dist, { recursive: true, force: true }); }
