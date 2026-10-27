// Headless screenshots of the key looks -> web/shots/*.png. Needs a running dev/preview server.
// CHROME=/path/to/chrome BASE=http://localhost:5173 node scripts/shots.mjs [name...]
import puppeteer from 'puppeteer-core';

const BASE = process.env.BASE ?? 'http://localhost:5173';
import { existsSync, readdirSync, mkdirSync } from 'node:fs';
const toolDir = new URL('../../../.tools/pl-browsers/chrome-headless-shell/', import.meta.url).pathname;
const CHROME = process.env.CHROME ?? (existsSync(toolDir) ? readdirSync(toolDir).map((v) => `${toolDir}${v}/chrome-headless-shell-linux64/chrome-headless-shell`).find(existsSync) : '/usr/bin/chromium-browser');
const M = process.env.MATCH ?? 'match', F = process.env.FORK ?? 'fork-step_up', T = process.env.T ?? '30.5';
const SHOTS = {
  'broadcast-casual': `?match=${M}&t=${T}&lens=0&paused=1`,
  'broadcast-tactical': `?match=${M}&t=${T}&lens=1&paused=1`,
  'tactical-cam': `?match=${M}&t=${T}&lens=1&cam=tactical&paused=1`,
  'player-cam': `?match=${M}&t=${T}&lens=0.5&cam=player&paused=1`,
  'split-whatif': `?match=${M}&fork=${F}&view=split&lens=0.6&paused=1&t=${process.env.FT ?? '68.6'}`,
  'ghost-whatif': `?match=${M}&fork=${F}&view=ghost&lens=0.3&paused=1&t=${process.env.FT ?? '68.6'}`,
};
const only = process.argv.slice(2);
mkdirSync(new URL('../shots/', import.meta.url), { recursive: true });

const browser = await puppeteer.launch({
  executablePath: CHROME, headless: true, protocolTimeout: 600000,
  args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--window-size=1600,900'],
});
try {
  for (const [name, qs] of Object.entries(SHOTS)) {
    if (only.length && !only.includes(name)) continue;
    const page = await browser.newPage();
    await page.setViewport({ width: 1600, height: 900, deviceScaleFactor: 1 });
    page.on('pageerror', (e) => console.error(name, 'pageerror', e.message));
    page.on('console', (m) => m.type() === 'error' && console.error(name, 'console', m.text()));
    await page.goto(BASE + '/' + qs, { waitUntil: 'load' });
    await page.waitForFunction('window.__frames > 12', { timeout: 180000, polling: 250 });
    const path = new URL(`../shots/${name}.png`, import.meta.url).pathname;
    await page.screenshot({ path });
    console.log('wrote', path);
    await page.close();
  }
} finally { await browser.close(); }
