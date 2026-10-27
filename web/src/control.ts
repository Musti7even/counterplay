// Control-room strip: the six-agent crew as a broadcast gallery, replaying a run's trace.json in sync with playback.
// Trace steps are spread evenly (by order) over a playback window; wall-clock gaps in a template run are ~ms.
const AGENTS = [
  ['analyst', 'ANALYST', 'picks moments'], ['tactician', 'TACTICIAN', 'explains why'], ['whatif', 'WHAT-IF', 'runs the fork'],
  ['factcheck', 'FACT-CHECK', 'verifies numbers'], ['producer', 'PRODUCER', 'cues the show'], ['localizer', 'LOCALIZER', 'speaks the language'],
] as const;

interface Step { t_wall: number; agent: string; action: string; input_summary: string; output_summary: string; ok: boolean; fallback: boolean }
interface Trace { run: string; mode: string; steps: Step[] }

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const json = (s: string) => { try { return JSON.parse(s); } catch { return null; } };
const short = (v: unknown) => { const s = typeof v === 'string' ? v : JSON.stringify(v); return s.length > 18 ? s.slice(0, 17) + '…' : s; };

function chipText(st: Step): { text: string; kind: 'tool' | 'err' | 'rec' | 'ok' } | null {
  if (st.action.startsWith('mcp:')) {
    const args = json(st.input_summary) ?? {};
    const vals = Object.entries(args).filter(([k]) => k !== 'match').map(([, v]) => short(v));
    return { text: `${st.action.slice(4)}(${vals.join(', ')})`, kind: 'tool' };
  }
  if (!st.ok) return { text: `✗ ${st.input_summary} · ${st.output_summary.replace(/^\w+Error:\s*/, '')}`, kind: 'err' };
  return null;
}

export async function loadTrace(url: string): Promise<Trace> {
  const r = await fetch(url.replace(/^\//, ''));
  if (!r.ok) throw new Error(`trace ${url}: ${r.status}`);
  return r.json();
}

export class ControlStrip {
  el = document.createElement('div');
  private nodes = new Map<string, HTMLElement>();
  private links: HTMLElement[] = [];
  private times: number[];
  private lastK = -1;

  constructor(private tr: Trace, private span: [number, number]) {
    const n = tr.steps.length;
    this.times = tr.steps.map((_, i) => span[0] + ((span[1] - span[0]) * i) / Math.max(1, n - 1));
    const llm = tr.mode !== 'template';
    this.el.id = 'control';
    this.el.innerHTML = `<div class="cr-head"><div class="cr-onair"><i></i>AI PRODUCTION GALLERY</div>
      <div class="cr-run">${esc(tr.run)}</div><div class="cr-mode ${llm ? 'llm' : ''}">${llm ? 'LLM AGENTS' : 'TEMPLATE MODE'} · MCP</div>
      <div class="cr-out"></div></div><div class="cr-crew"></div>`;
    const crew = this.el.querySelector('.cr-crew')!;
    AGENTS.forEach(([id, name, role], i) => {
      if (i) { const l = document.createElement('div'); l.className = 'cr-link'; l.innerHTML = '<i></i>'; crew.append(l); this.links.push(l); }
      const node = document.createElement('div');
      node.className = 'cr-node';
      node.innerHTML = `<div class="cr-n-top"><span class="cr-idx">0${i + 1}</span><span class="cr-name">${name}</span><span class="cr-state"></span></div>
        <div class="cr-role">${role}</div><div class="cr-chips"></div>`;
      crew.append(node); this.nodes.set(id, node);
    });
    document.body.append(this.el);
    document.body.classList.add('control');
  }

  update(t: number) {
    const S = this.tr.steps;
    let k = 0;
    while (k < S.length && this.times[k] <= t) k++;
    // handoff pulses travel along the link into the receiving agent
    this.links.forEach((l, i) => {
      const hi = S.findIndex((s, j) => j < k && s.action === 'handoff' && s.agent === AGENTS[i + 1][0] && t - this.times[j] < 0.6);
      const dot = l.firstElementChild as HTMLElement;
      if (hi >= 0) { const p = (t - this.times[hi]) / 0.6; dot.style.left = `${p * 100}%`; dot.style.opacity = String(Math.sin(p * Math.PI)); }
      else dot.style.opacity = '0';
      const reached = S.some((s, j) => j < k && s.agent === AGENTS[i + 1][0]);
      l.classList.toggle('on', reached);
    });
    if (k === this.lastK) return;
    this.lastK = k;
    const seen = S.slice(0, k), cur = [...seen].reverse().find((s) => s.agent !== 'crew')?.agent;
    const done = seen.some((s) => s.agent === 'crew' && s.action === 'done');
    for (const [id, node] of this.nodes) {
      const mine = seen.filter((s) => s.agent === id);
      const failed = mine.some((s) => !s.ok), recovered = failed && mine.some((s, j) => s.fallback && j > mine.findIndex((x) => !x.ok));
      const llmFallback = this.tr.mode !== 'template' && mine.some((s) => s.fallback);
      let state = '', cls = 'idle';
      if (mine.length) { cls = 'done'; state = '✓'; }
      if (id === cur && !done) { cls = 'live'; state = 'LIVE'; }
      if (failed && !recovered) { cls = 'err'; state = 'ERROR'; }
      if (recovered || llmFallback) { cls = 'rec'; state = 'RECOVERED · template'; }
      node.className = `cr-node ${cls}`;
      node.querySelector('.cr-state')!.textContent = state;
      // chips: newest last; fact-check shows aired/rejected claims
      const chips = mine.map((s) => ({ s, c: chipText(s) })).filter((x) => x.c);
      const firstErr = chips.find((x) => x.c!.kind === 'err');
      const pick = (failed ? [firstErr, ...chips.filter((x) => x.c!.kind === 'tool').slice(-1)] : chips.slice(-2)).filter((x) => !!x) as typeof chips;
      let html = pick.map(({ c }, j, arr) => `<span class="cr-chip ${c!.kind}${j === arr.length - 1 ? ' new' : ''}">${esc(c!.text)}</span>`).join('');
      const verify = mine.find((s) => s.action === 'verify');
      if (verify) {
        const v = json(verify.output_summary) ?? {};
        const ok = (v.aired_ok ?? []) as unknown[], rej = (v.rejected ?? []) as any[];
        html = `<span class="cr-chip tool">${esc(verify.input_summary)}</span>` +
          ok.map((c) => `<span class="cr-claim ok">${esc(String(c))} ✓</span>`).join('') +
          rej.map((c) => `<span class="cr-claim rej">${esc(String(c?.claim ?? c?.id ?? c))}</span>`).join('');
      }
      if (cls === 'rec') html += `<span class="cr-chip rec">RECOVERED · template</span>`;
      node.querySelector('.cr-chips')!.innerHTML = html;
    }
    const fin = seen.find((s) => s.agent === 'crew' && s.action === 'done');
    this.el.querySelector('.cr-out')!.textContent = fin ? `ON AIR · ${fin.output_summary}` : `${k}/${S.length} steps`;
  }
}
