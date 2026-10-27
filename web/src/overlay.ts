// Per-view broadcast overlay: persona label chip, director captions, AI commentary subtitles (+ voice), mini tactics panel.
// Used by the quad view (one per quadrant) and, for subtitles only, by the single/split views.
import { Match, Snapshot, Side, TeamMetrics, clock } from './data';
import type { DirectorState } from './director';

export interface Line { t: number; text: string; voice_style?: string; claim?: string }
export interface Voice { t: number; url: string; dur?: number }
export interface Commentary { run: string; lang: string; lines: Line[]; voice: Voice[] }

// <run>.commentary.json + optional data/audio/<run>/voice.json [{t, file, dur, text}]
export async function loadCommentary(url: string): Promise<Commentary> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`commentary ${url}: ${res.status}`);
  const lines = ((await res.json()) as Line[]).sort((a, b) => a.t - b.t);
  const run = url.split('/').pop()!.replace(/\.commentary\.json$/, '');
  let voice: Voice[] = [];
  const v = await fetch(`/data/audio/${run}/voice.json`).catch(() => null);
  if (v?.ok && (v.headers.get('content-type') ?? '').includes('json'))
    voice = ((await v.json()) as { t: number; file: string; dur?: number }[]).map((e) => ({ t: e.t, dur: e.dur, url: `/data/audio/${run}/${e.file}` }));
  return { run, lang: run.split('.').pop() ?? '', lines, voice };
}

const esc = (s: string) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]!);
const setText = (el: Element, s: string) => { if (el.textContent !== s) el.textContent = s; };

export class Overlay {
  root = document.createElement('div');
  private sub = document.createElement('div');
  private caps = new Map<string, HTMLElement>();
  private label?: HTMLElement; private panel?: HTMLElement;
  private playing: HTMLAudioElement[] = [];
  private lastT = -1;

  constructor(parent: HTMLElement, private o: { label?: string; panel?: boolean; match?: Match; commentary?: Commentary | null; audio?: boolean }) {
    this.root.className = 'ov';
    this.sub.className = 'ov-sub';
    this.sub.innerHTML = `<div class="ov-sub-tag">AI COMMENTARY<b></b></div><div class="ov-sub-text"></div>`;
    this.root.append(this.sub);
    if (o.label) {
      this.label = document.createElement('div'); this.label.className = 'ov-label';
      this.label.innerHTML = `<span class="ov-persona">${esc(o.label)}</span><span class="ov-score"></span><span class="ov-clock"></span>`;
      this.root.append(this.label);
    }
    if (o.panel && o.match) {
      const m = o.match;
      this.panel = document.createElement('div'); this.panel.className = 'ov-panel';
      this.panel.innerHTML = `<div class="ovp-h"><span></span><b style="border-color:${m.meta.home.color}">${m.meta.home.short}</b><b style="border-color:${m.meta.away.color}">${m.meta.away.short}</b></div>
        ${[['SHAPE', 'label'], ['IN POSS', 'poss'], ['LINE', 'line'], ['L × W', 'cmp']].map(([k, d]) => `<div class="ovp-r"><span>${k}</span><b data-k="${d}-home"></b><b data-k="${d}-away"></b></div>`).join('')}`;
      this.root.append(this.panel);
    }
    parent.append(this.root);
    if (o.commentary) setText(this.sub.querySelector('b')!, ` · ${o.commentary.lang.toUpperCase()}`);
  }

  update(s: Snapshot, captions: DirectorState['captions'] | null, met?: Record<Side, TeamMetrics>, playingAudio = false) {
    const t = s.t;
    if (this.label) { setText(this.label.querySelector('.ov-score')!, s.score.join(' – ')); setText(this.label.querySelector('.ov-clock')!, clock(t)); }
    if (this.panel && met) for (const side of ['home', 'away'] as Side[]) {
      const m = met[side], q = (k: string) => this.panel!.querySelector(`[data-k=${k}-${side}]`)!;
      setText(q('label'), m.label); setText(q('poss'), m.inPoss ?? '—');
      setText(q('line'), `${m.lineHeight.toFixed(1)}`); setText(q('cmp'), `${m.length.toFixed(0)}×${m.width.toFixed(0)}`);
    }
    // captions (quad: inside this quadrant)
    if (captions) {
      for (const [k, el] of this.caps) if (!captions[k]) el.style.opacity = '0';
      for (const [k, c] of Object.entries(captions)) {
        let el = this.caps.get(k);
        if (!el) { el = document.createElement('div'); el.className = 'ov-cap'; el.innerHTML = '<div class="cp-title"></div><div class="cp-text"></div>'; this.root.append(el); this.caps.set(k, el); }
        const age = t - c.t0, out = (c.dur ?? 4) - age, a = Math.max(0, Math.min(1, age / 0.4, out / 0.4)), e = 1 - (1 - a) ** 3;
        el.style.opacity = String(a); el.style.transform = `translateX(${(1 - e) * -30}px)`;
        const ti = el.querySelector('.cp-title') as HTMLElement;
        setText(ti, c.title ?? ''); ti.style.display = c.title ? '' : 'none'; setText(el.querySelector('.cp-text')!, c.text);
      }
    }
    // commentary subtitle: from its t until ~reading time or the next line
    const L = this.o.commentary?.lines ?? [];
    let i = -1;
    for (let k = 0; k < L.length && L[k].t <= t; k++) i = k;
    const line = i >= 0 ? L[i] : null;
    const dur = line ? Math.min(Math.max(3, line.text.split(/\s+/).length * 0.42 + 1), (L[i + 1]?.t ?? Infinity) - line.t) : 0;
    const a = line ? Math.max(0, Math.min(1, (t - line.t) / 0.25, (line.t + dur - t) / 0.35)) : 0;
    this.sub.style.opacity = String(a); this.sub.style.transform = `translateX(-50%) translateY(${(1 - a) * 10}px)`;
    if (line) setText(this.sub.querySelector('.ov-sub-text')!, line.text);
    this.sub.classList.toggle('excited', line?.voice_style === 'excited');
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
