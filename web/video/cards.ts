// Video title cards (interstitials, rewind overlay, architecture, end card), screenshotted by scripts/cards.mjs.
import '@fontsource/barlow-condensed/600.css';
import '@fontsource/barlow-condensed/700.css';
import '@fontsource/barlow-condensed/800.css';
import '@fontsource/barlow-condensed/800-italic.css';
import '@fontsource/barlow/500.css';
import './cards.css';

const q = new URLSearchParams(location.search), card = q.get('card') ?? 'inter', el = document.getElementById('card')!;
document.body.className = `c-${card}`;
const box = (k: string, title: string, sub: string, cls = '') => `<div class="ar-box ${cls}"><b>${k}</b><span>${title}</span><small>${sub}</small></div>`;

if (card === 'inter') el.innerHTML = `<div class="in-wrap"><i class="in-bar"></i><h2>${q.get('text') ?? ''}</h2></div>`;
if (card === 'rewind') el.innerHTML = `<div class="rw"><span class="rw-icon">◀◀</span><span class="rw-t">REWIND</span><span class="rw-time">${q.get('time') ?? '01:06'}</span></div>`;
if (card === 'end') el.innerHTML = `<div class="end"><h1>COUNTER<span>PLAY</span></h1><p>Every match. Every fan. Every what-if.</p><div class="end-url">github.com/&lt;team&gt;/counterplay</div></div>`;
if (card === 'arch') el.innerHTML = `<div class="ar"><div class="ar-kick">HOW IT WORKS</div>
  <div class="ar-row">
    ${box('01', 'GRF MATCH ENGINE', 'Google Research Football · synthetic matches · Apache-2.0')}
    <i class="ar-arrow"></i>
    ${box('02', 'INSIGHTS', 'moments · xG · shape · deterministic forks')}
    <i class="ar-arrow"></i>
    ${box('03', 'MCP SERVER', '7 tools incl. <code>fork_what_if</code>')}
    <i class="ar-arrow"></i>
    ${box('04', 'AGENT CREW', 'Microsoft Agent Framework · 6 agents<br>Azure OpenAI / Foundry', 'ms')}
    <i class="ar-arrow"></i>
    ${box('05', 'DIRECTOR CUES', 'camera · lens · captions · commentary JSON')}
    <i class="ar-arrow"></i>
    ${box('06', 'THREE.JS RENDERER', 'broadcast graphics · split · ghost · quad')}
  </div>
  <div class="ar-crew">${['Analyst', 'Tactician', 'What-If', 'Fact-checker', 'Producer', 'Localizer'].map((a) => `<span>${a}</span>`).join('')}</div>
  <div class="ar-azure"><span class="az">Azure AI Speech</span><span class="az">Azure Container Apps</span><span class="az">Azure OpenAI / Foundry</span></div>
</div>`;
(window as any).__ready = true;
