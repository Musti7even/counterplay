// Screenshot the video title cards (web/video/cards.html) to shots/cards/*.png. Needs the dev server (BASE).
import puppeteer from 'puppeteer-core';
import { existsSync, readdirSync, mkdirSync } from 'node:fs';
const BASE = process.env.BASE ?? 'http://localhost:5173';
const toolDir = new URL('../../../.tools/pl-browsers/chrome-headless-shell/', import.meta.url).pathname;
const CHROME = process.env.CHROME ?? readdirSync(toolDir).map((v) => `${toolDir}${v}/chrome-headless-shell-linux64/chrome-headless-shell`).find(existsSync);
// v2-*: transparent overlays for the v2 cut (LINEH is filled from LINEH env: the line-height value on the frozen frame)
const CARDS = {
  'inter-whatif': 'card=inter&kicker=The what-if&text=What if one defender stepped up?',
  'inter-quad': 'card=inter&kicker=Every fan&text=Same moment. Four fans.',
  'inter-agents': 'card=inter&kicker=AI production gallery&text=Six agents. Every number verified.',
  rewind: 'card=rewind&time=01:06',
  arch: 'card=arch',
  end: 'card=end',
  'v2-bar1': 'card=bar&n=1',
  'v2-bar2': 'card=bar&n=2',
  'v2-bar3': 'card=bar&n=3',
  'v2-bar4': 'card=bar&n=4',
  'v2-bar5': 'card=bar&n=5',
  'v2-hook1': 'card=hook&t=TV shows what happened.',
  'v2-hook2': 'card=hook&t=We show what <em>would</em> have happened.',
  'v2-rewind': 'card=rewind&time=01:06',
  'v2-c2a': 'card=cap&k=Why&t=Halvard’s back line',
  'v2-c2b': 'card=cap&k=Why&t=Sits LINEH m from goal',
  'v2-c2c': 'card=cap&k=Why&t=Moreau runs into the gap',
  'v2-c3a': 'card=cap&sig=whatif&k=What if&t=What if Sørensen steps up?',
  'v2-c3b': 'card=cap&sig=whatif&k=What if&t=Same match. One decision changed.',
  'v2-c3c': 'card=cap&sig=whatif&k=Result&t=1–0 becomes 0–0',
  'v2-c4': 'card=cap&k=Every fan&t=One moment. Four fans.',
  'v2-c4a': 'card=cap&k=Fan 1&t=Casual · English',
  'v2-c4b': 'card=cap&k=Fan 2&t=Analyst',
  'v2-c4c': 'card=cap&k=Fan 3&t=Player cam · Deutsch',
  'v2-c4d': 'card=cap&k=Fan 4&t=Casual · Türkçe',
  'v2-c5intro': 'card=cap&up=1&k=How&t=Six AI agents run the broadcast',
  'v2-c5analyst': 'card=cap&up=1&k=Analyst&t=Picks the moment worth showing',
  'v2-c5tfail': 'card=cap&up=1&sig=alert&k=Tactician&t=One agent fails',
  'v2-c5trec': 'card=cap&up=1&sig=alert&k=Tactician&t=Template takes over. The show goes on.',
  'v2-c5whatif': 'card=cap&up=1&sig=whatif&k=What-if&t=Re-simulates the match from 01:06',
  'v2-c5fact': 'card=cap&up=1&k=Fact-check&t=Every number checked against the engine',
  'v2-c5producer': 'card=cap&up=1&k=Producer&t=Cues camera, lens and captions',
  'v2-c5local': 'card=cap&up=1&k=Localizer&t=Speaks every fan’s language',
};
const only = process.argv.slice(2);
const out = new URL('../shots/cards/', import.meta.url).pathname;
mkdirSync(out, { recursive: true });
const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] });
const page = await browser.newPage();
await page.setViewport({ width: 1920, height: 1080 });
for (const [name, qs] of Object.entries(CARDS)) {
  if (only.length && !only.some((o) => name.startsWith(o))) continue;
  await page.goto(`${BASE}/video/cards.html?${qs.replace('LINEH', process.env.LINEH ?? '?')}`, { waitUntil: 'load' });
  await page.waitForFunction('window.__ready === true'); await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: `${out}${name}.png`, omitBackground: name === 'rewind' || (name.startsWith('v2-') && !name.startsWith('v2-hook')) });
  console.log('wrote', name);
}
await browser.close();
