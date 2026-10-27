// Screenshot the video title cards (web/video/cards.html) to shots/cards/*.png. Needs the dev server (BASE).
import puppeteer from 'puppeteer-core';
import { existsSync, readdirSync, mkdirSync } from 'node:fs';
const BASE = process.env.BASE ?? 'http://localhost:5173';
const toolDir = new URL('../../../.tools/pl-browsers/chrome-headless-shell/', import.meta.url).pathname;
const CHROME = process.env.CHROME ?? readdirSync(toolDir).map((v) => `${toolDir}${v}/chrome-headless-shell-linux64/chrome-headless-shell`).find(existsSync);
const CARDS = {
  'inter-whatif': 'card=inter&kicker=The what-if&text=What if one defender stepped up?',
  'inter-quad': 'card=inter&kicker=Every fan&text=Same moment. Four fans.',
  'inter-agents': 'card=inter&kicker=AI production gallery&text=Six agents. Every number verified.',
  rewind: 'card=rewind&time=01:06',
  arch: 'card=arch',
  end: 'card=end',
};
const out = new URL('../shots/cards/', import.meta.url).pathname;
mkdirSync(out, { recursive: true });
const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] });
const page = await browser.newPage();
await page.setViewport({ width: 1920, height: 1080 });
for (const [name, qs] of Object.entries(CARDS)) {
  await page.goto(`${BASE}/video/cards.html?${qs}`, { waitUntil: 'load' });
  await page.waitForFunction('window.__ready === true'); await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: `${out}${name}.png`, omitBackground: name === 'rewind' });
  console.log('wrote', name);
}
await browser.close();
