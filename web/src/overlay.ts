// AI commentary loading + the per-view overlay (quad quadrants; subtitles only in single/split).
import { Match, Snapshot, Side, TeamMetrics, clock } from './data';
import type { DirectorState } from './director';
import { lowerThird, showLowerThird, setText } from './hud';

export interface Line { t: number; text: string; voice_style?: string; claim?: string }
export interface Voice { t: number; url: string; dur?: number }
export interface Commentary { run: string; lang: string; lines: Line[]; voice: Voice[] }

// <run>.commentary.json + optional data/audio/<run>/voice.json [{t, file, dur, text}]
export async function loadCommentary(url: string): Promise<Commentary> {
  const res = await fetch(url.replace(/^\//, ''));
  if (!res.ok) throw new Error(`commentary ${url}: ${res.status}`);
  const lines = ((await res.json()) as Line[]).sort((a, b) => a.t - b.t);
  const run = url.split('/').pop()!.replace(/\.commentary\.json$/, '');
  let voice: Voice[] = [];
  const v = await fetch(`data/audio/${run}/voice.json`).catch(() => null);
  if (v?.ok && (v.headers.get('content-type') ?? '').includes('json'))
    voice = ((await v.json()) as { t: number; file: string; dur?: number }[]).map((e) => ({ t: e.t, dur: e.dur, url: `data/audio/${run}/${e.file}` }));
  // <match>.<persona>.<lang>[.<variant>]: the language is the 2-letter part, not just the last one
  return { run, lang: run.split('.').slice(1).reverse().find((p) => /^[a-z]{2}$/.test(p)) ?? '', lines, voice };
}

const esc = (s: string) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]!);

export type Variant = 'casual' | 'analyst' | 'player' | 'lang';
export interface PlayerCard { num: number; name: string; color: string; kmh: number; dist: number; hr: number }
const LANGS: Record<string, string> = { en: 'English', de: 'Deutsch', tr: 'Türkçe', es: 'Español' };

// Per-view overlay built from the shared components: scorebug + persona badge (top left), stat card (top right),
// lower thirds (bottom left), AI commentary subtitle (bottom centre). In quad the subtree is scaled down with --k.
export class Overlay {
  root = document.createElement('div');
  private sub = lowerThird('sub');
  private zone = document.createElement('div');
  private caps = new Map<string, HTMLElement>();
  private sb?: HTMLElement; private panel?: HTMLElement; private card?: HTMLElement;
  private playing: HTMLAudioElement[] = [];
  private lastT = -1;

  constructor(parent: HTMLElement, private o: { label?: string; panel?: boolean; match?: Match; commentary?: Commentary | null; audio?: boolean; variant?: Variant }) {
    this.root.className = 'ov';
    this.sub.classList.add('ov-sub');
    this.zone.className = 'ov-zone';
    this.root.append(this.zone, this.sub);
    const m = o.match;
    if (o.label && m) {
      this.root.classList.add('scaled');
      const top = document.createElement('div'); top.className = 'ov-top';
      top.innerHTML = `<div class="sb"><span class="sb-team home"><i style="background:${m.meta.home.color}"></i>${m.meta.home.short}</span>
        <span class="sb-score"><span class="h"></span><span class="sep">–</span><span class="a"></span></span>
        <span class="sb-team away">${m.meta.away.short}<i style="background:${m.meta.away.color}"></i></span><span class="sb-clock"></span></div>
        <span class="badge plain"><span>${esc(o.label)}</span></span>`;
      this.root.append(top); this.sb = top.querySelector('.sb')!;
    }
    if (o.panel && m) {
      this.panel = document.createElement('div'); this.panel.className = 'card ov-tr';
      this.panel.innerHTML = `<div class="card-head"><span>Shape · 20 s</span><b style="--team:${m.meta.home.color}">${m.meta.home.short}</b><b style="--team:${m.meta.away.color}">${m.meta.away.short}</b></div>
        ${[['Formation', 'label'], ['Line height', 'line'], ['Length × width', 'cmp']].map(([k, d]) => `<div class="card-row"><span>${k}</span><b data-k="${d}-home"></b><b data-k="${d}-away"></b></div>`).join('')}`;
      this.root.append(this.panel);
    }
    if (o.variant) parent.classList.add(`v-${o.variant}`);
    if (o.variant === 'player') {
      this.card = document.createElement('div'); this.card.className = 'card one ov-tr';
      this.card.innerHTML = `<div class="card-head player"><i></i><span class="num"></span><span class="name"></span></div>
        <div class="card-row"><span>Speed</span><b class="pc-kmh"></b></div><div class="card-row"><span>Distance</span><b class="pc-dist"></b></div>
        <div class="card-row"><span>Heart rate*</span><b class="pc-hr"></b></div><div class="card-note">*modelled from workload</div>`;
      this.root.append(this.card);
    }
    parent.append(this.root);
    const lang = o.commentary?.lang ?? '';
    setText(this.sub.querySelector('.lt-kicker')!, `AI commentary · ${LANGS[lang] ?? lang.toUpperCase()}`);
  }

  update(s: Snapshot, captions: DirectorState['captions'] | null, met?: Record<Side, TeamMetrics>, playingAudio = false, card?: PlayerCard | null) {
    const t = s.t;
    if (this.sb) { setText(this.sb.querySelector('.h')!, String(s.score[0])); setText(this.sb.querySelector('.a')!, String(s.score[1])); setText(this.sb.querySelector('.sb-clock')!, clock(t)); }
    if (this.panel && met) for (const side of ['home', 'away'] as Side[]) {
      const mt = met[side], q = (k: string) => this.panel!.querySelector(`[data-k=${k}-${side}]`)!;
      setText(q('label'), mt.label); setText(q('line'), `${mt.lineHeight.toFixed(1)} m`); setText(q('cmp'), `${mt.length.toFixed(0)}×${mt.width.toFixed(0)}`);
    }
    // captions: lower thirds inside this view
    if (captions) {
      for (const [k, el] of this.caps) if (!captions[k]) el.style.display = 'none';
      for (const [k, c] of Object.entries(captions)) {
        let el = this.caps.get(k);
        if (!el) { el = lowerThird(k === 'whatif' ? 'whatif' : ''); this.zone.append(el); this.caps.set(k, el); }
        showLowerThird(el, t, c.t0, c.dur ?? 4, c.title ?? '', c.text);
      }
    }
    // commentary subtitle: from its t until ~reading time or the next line
    const L = this.o.commentary?.lines ?? [];
    let i = -1;
    for (let k = 0; k < L.length && L[k].t <= t; k++) i = k;
    const line = i >= 0 ? L[i] : null;
    const dur = line ? Math.min(Math.max(3, line.text.split(/\s+/).length * 0.42 + 1), (L[i + 1]?.t ?? Infinity) - line.t) : 0;
    if (line) showLowerThird(this.sub, t, line.t, dur, (this.sub.querySelector('.lt-kicker') as HTMLElement).textContent!, line.text);
    else this.sub.style.display = 'none';
    if (this.card) {
      this.card.style.display = card ? '' : 'none';
      if (card) {
        const q = (c: string) => this.card!.querySelector(c)! as HTMLElement;
        this.card.style.setProperty('--team', card.color);
        setText(q('.num'), String(card.num)); setText(q('.name'), card.name);
        q('.pc-kmh').innerHTML = `${card.kmh.toFixed(1)}<small>km/h</small>`; q('.pc-kmh').classList.toggle('live', card.kmh > 27);
        q('.pc-dist').innerHTML = `${card.dist.toFixed(0)}<small>m</small>`; q('.pc-hr').innerHTML = `${card.hr.toFixed(0)}<small>bpm</small>`;
      }
    }
    // voice: realtime playback only (the recorder muxes audio from demo.audio instead)
    if (this.o.audio && playingAudio) {
      for (const v of this.o.commentary?.voice ?? []) if (this.lastT < v.t && t >= v.t && t - v.t < 0.5) {
        const au = new Audio(v.url); au.play().catch(() => {}); this.playing.push(au);
      }
    }
    if (!playingAudio || Math.abs(t - this.lastT) > 1) { this.playing.forEach((au) => au.pause()); this.playing = []; }
    this.lastT = t;
  }
}
