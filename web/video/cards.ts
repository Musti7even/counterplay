// Video title cards (interstitials, rewind overlay, architecture, end card), screenshotted by scripts/cards.mjs.
// Built from the shared components: full-screen card, agent card, label badge.
import '../src/tokens.css';
import '../src/style.css';
import './cards.css';

const q = new URLSearchParams(location.search), card = q.get('card') ?? 'inter', el = document.getElementById('card')!;
document.body.className = `c-${card}`;
const node = (k: string, title: string, sub: string, cls = '') =>
  `<div class="agent ${cls}"><div class="ag-top"><span class="ag-idx">${k}</span><span class="ag-name">${title}</span></div><div class="ag-role">${sub}</div></div>`;

if (card === 'inter') el.innerHTML = `<div class="fs-kicker">${q.get('kicker') ?? ''}</div><h1 class="fs-title">${q.get('text') ?? ''}</h1>`;
if (card === 'rewind') el.innerHTML = `<div class="rw scaled"><span class="badge whatif"><span>Rewind</span><span class="bd-v">${q.get('time') ?? '01:06'}</span></span></div>`;
if (card === 'end') el.innerHTML = `<div class="end"><h1 class="fs-title">Counterplay</h1><p class="fs-line">${q.get('line') ?? 'Every match. Every fan. Every what-if.'}</p>
  <div class="end-url">github.com/&lt;team&gt;/counterplay</div></div>`;
if (card === 'arch') el.innerHTML = `<div class="fs-kicker">How it works</div>
  <div class="ar-row">
    ${node('01', 'Match engine', 'Google Research Football, seeded 11v11, forkable state')}<i class="ar-arrow"></i>
    ${node('02', 'Insights', 'Events, xG, shape, moments with evidence')}<i class="ar-arrow"></i>
    ${node('03', 'MCP server', '7 tools incl. fork_what_if')}<i class="ar-arrow"></i>
    ${node('04', 'Agent crew', 'Microsoft Agent Framework, 6 agents, template fallback', 'focus')}<i class="ar-arrow"></i>
    ${node('05', 'Director cues', 'Camera, lens, captions, commentary JSON')}<i class="ar-arrow"></i>
    ${node('06', 'Renderer', 'three.js broadcast: split, ghost, quad')}
  </div>
  <div class="ar-note">Model + voice backends: Azure OpenAI / Foundry · Azure AI Speech (configurable)</div>`;
// demo v2 overlays (transparent, composited in ffmpeg): chapter bar, lower-third caption, hook lines
const CH = q.get('names')?.split('|') ?? ['What happened', 'Why', 'What if', 'Every fan', 'How'];
if (card === 'bar') { const n = +(q.get('n') ?? 1);
  el.innerHTML = `<div class="chbar">${CH.map((c, i) => `<span class="${i + 1 === n ? 'on' : ''}"><b>${i + 1}</b>${c}</span>`).join('')}</div>`; }
if (card === 'cap') el.innerHTML = `<div class="capz ${q.get('up') ? 'up' : ''}"><div class="lt ${q.get('sig') ?? ''}"><div class="lt-body">${q.get('k') ? `<div class="lt-kicker">${q.get('k')}</div>` : ''}<div class="lt-line">${q.get('t') ?? ''}</div></div></div></div>`;
// quad persona labels, drawn over the baked ones (same spot in each quadrant of a 1920x1080 quad frame)
if (card === 'qlabels') el.innerHTML = ['l1', 'l2', 'l3', 'l4'].map((k, i) =>
  `<span class="badge plain qlab" style="left:${(i % 2) * 960 + 46}px;top:${Math.floor(i / 2) * 540 + 62}px"><span>${q.get(k) ?? ''}</span></span>`).join('');
// v4: voice command pill (bottom-left) + tool-call chip under it; part=pill|chip renders one, both at fixed positions
if (card === 'cmd') { const part = q.get('part') ?? 'pill';
  el.innerHTML = `<div class="cmdz"><div class="pill ${part === 'pill' ? '' : 'hid'}"><i class="mic"></i><span>${q.get('t') ?? ''}</span></div>
    <div class="chip new cmdchip ${part === 'chip' ? '' : 'hid'}">${q.get('c') ?? ''}</div></div>`; }
if (card === 'sim') el.innerHTML = `<div class="simz"><span class="badge whatif"><span>What if</span><span class="bd-v">Simulating…</span></span></div>`;
if (card === 'sub') el.innerHTML = `<div class="subz"><div class="lt sub"><div class="lt-body"><div class="lt-kicker">${q.get('k') ?? ''}</div><div class="lt-line">${q.get('t') ?? ''}</div></div></div></div>`;
if (card === 'hook') el.innerHTML = `<h1 class="fs-title hook">${q.get('t') ?? ''}</h1>`;
document.fonts.ready.then(() => { (window as any).__ready = true; });
