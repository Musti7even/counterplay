// v4 overlays: voice-command pills + tool chips (data/commands/<n>.json if present, else the story.md lines),
// commentary subtitles (data/audio/<run>/voice.json text, else <run>.commentary.json), simulating badge, end card.
// Writes shots/cards/v4-*.png + shots/cards/v4-manifest.json. Needs the dev server: BASE=http://localhost:5173 node scripts/cards-v4.mjs
import puppeteer from 'puppeteer-core';
import { existsSync, readdirSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const BASE = process.env.BASE ?? 'http://localhost:5173';
const DATA = new URL('../../data/', import.meta.url).pathname;
const toolDir = new URL('../../../.tools/pl-browsers/chrome-headless-shell/', import.meta.url).pathname;
const CHROME = process.env.CHROME ?? readdirSync(toolDir).map((v) => `${toolDir}${v}/chrome-headless-shell-linux64/chrome-headless-shell`).find(existsSync);

// story.md v4. chip = a real MCP tool (engine/mcp_server.py) or crew/director call; replaced by data/commands/<n>.json
const DEFAULT = [
  { text: 'We’re watching a match live. Minute sixty-nine. Watch this.', chip: 'tool · seek(63)' },
  { text: 'Show me that goal from four angles.', chip: 'tool · set_view(angles4)' },
  { text: 'My uncle says it’s Sørensen’s fault. Show me what happens if he steps up.', chip: 'tool · fork_what_if(66.5, step_up, a6)' },
  { text: 'My uncle’s new to football. Make the commentary simple.', chip: 'tool · set_commentary_level(simple)' },
  { text: 'Now in Spanish.', chip: 'tool · set_language(es)' },
  { text: 'How would a German commentator call it?', chip: 'tool · set_language(de)' },
  { text: 'When I watch alone, I want the full tactics.', chip: 'tool · set_commentary_level(expert) · highlight_players([h8, a6]) · set_language(en)' },
];
const cmds = DEFAULT.map((d, i) => {
  const f = `${DATA}commands/${i + 1}.json`;
  if (!existsSync(f)) return { ...d, src: 'story' };
  const j = JSON.parse(readFileSync(f, 'utf8'));
  // chip = the command agent's real tool calls (name + args); mode "rules" -> labelled as a tool call, never "AI"
  const fmt = (v) => (Array.isArray(v) ? `[${v.join(', ')}]` : String(v));
  const calls = (j.tool_calls ?? []).map((c) => `${c.name}(${Object.values(c.args ?? {}).map(fmt).join(', ')})`);
  return { text: j.text ?? d.text, chip: calls.length ? `tool · ${calls.join(' · ')}` : d.chip, run: j.run, mode: j.mode, src: f };
});
// voices: commands 4-7 name their commentary run (falls back to the story defaults)
const DEF_RUNS = ['match.casual.en.goal', 'match.casual.es.goal', 'match.casual.de.goal', 'match.analyst.en.goal'];
const runOk = (r) => r && existsSync(`${DATA}${r}.commentary.json`); // e.g. a run retired for licence reasons
export const RUNS = Object.fromEntries(['simple', 'lang2', 'lang3', 'expert'].map((k, i) => [k, runOk(cmds[3 + i]?.run) ? cmds[3 + i].run : DEF_RUNS[i]]));
const LANG = { en: 'English', es: 'Español', tr: 'Türkçe', de: 'Deutsch' };
const LABEL = Object.fromEntries(Object.entries(RUNS).map(([k, r]) => { const [, persona, lang] = r.split('.');
  return [k, `Commentary · ${LANG[lang] ?? lang}${lang === 'en' ? (persona === 'analyst' ? ' · expert' : ' · simple') : ''}`]; }));
const subs = {};
for (const [k, run] of Object.entries(RUNS)) {
  const vf = `${DATA}audio/${run}/voice.json`, cf = `${DATA}${run}.commentary.json`;
  const lines = existsSync(vf) ? JSON.parse(readFileSync(vf, 'utf8')) : existsSync(cf) ? JSON.parse(readFileSync(cf, 'utf8')) : [];
  // the goal call only (earlier lines would overlap it)
  subs[k] = lines.filter((l) => l.t >= 69 && l.t <= 72).map((l, i) => ({ t: l.t, dur: l.dur ?? null, text: l.text, png: `v4-sub-${k}-${i}.png` }));
}

const enc = encodeURIComponent;
const jobs = [];
cmds.forEach((c, i) => {
  // word-by-word typing: one pill per prefix
  const words = c.text.split(' ');
  c.words = words.length;
  words.forEach((_, k) => jobs.push([`v4-pill${i + 1}-${k + 1}.png`, `card=cmd&part=pill&t=${enc(words.slice(0, k + 1).join(' '))}&c=${enc(c.chip)}`]));
  jobs.push([`v4-chip${i + 1}.png`, `card=cmd&part=chip&t=${enc(c.text)}&c=${enc(c.chip)}`]);
});
for (const [k, L] of Object.entries(subs)) for (const l of L) jobs.push([l.png, `card=sub&k=${enc(LABEL[k])}&t=${enc(l.text)}`]);
jobs.push(['v4-sim.png', 'card=sim']);
jobs.push(['v4-end.png', `card=end&line=${enc('Your match, on command.')}`]);

const out = new URL('../shots/cards/', import.meta.url).pathname;
mkdirSync(out, { recursive: true });
const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] });
const page = await browser.newPage();
await page.setViewport({ width: 1920, height: 1080 });
for (const [name, qs] of jobs) {
  await page.goto(`${BASE}/video/cards.html?${qs}`, { waitUntil: 'load' });
  await page.waitForFunction('window.__ready === true'); await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: `${out}${name}`, omitBackground: name !== 'v4-end.png' });
}
await browser.close();
writeFileSync(`${out}v4-manifest.json`, JSON.stringify({ cmds: cmds.map((c, i) => ({ ...c, pill: `v4-pill${i + 1}`, chip: `v4-chip${i + 1}.png` })), subs, runs: RUNS }, null, 1));
console.log(`wrote ${jobs.length} overlays; commands from ${cmds.map((c) => (c.src === 'story' ? 'story' : 'data')).join(',')}`);
