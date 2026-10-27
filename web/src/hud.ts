// HTML overlay: scorebug, what-if strap, stat card, lower thirds (captions + goal), timeline markers. Pure DOM, no framework.
import { Match, Snapshot, TeamMetrics, Side, clock, duration, startTime } from './data';
import type { DirectorState } from './director';
import { T, envelope } from './tokens';

const $ = <T extends HTMLElement = HTMLElement>(sel: string) => document.querySelector(sel) as T;
export const setText = (el: Element, s: string) => { if (el.textContent !== s) el.textContent = s; };

// lower third component: [signal bar][kicker / line]
export function lowerThird(cls = '') {
  const el = document.createElement('div');
  el.className = `lt ${cls}`;
  el.innerHTML = '<div class="lt-body"><div class="lt-kicker"></div><div class="lt-line"></div></div>';
  return el;
}
// in = wipe from the bar side, out = fade (DESIGN.md motion rules); driven by match time so the recorder is exact
export function showLowerThird(el: HTMLElement, t: number, t0: number, dur: number, kicker: string, line: string) {
  const { a, reveal } = envelope(t, t0, dur);
  el.style.display = a > 0 ? '' : 'none';
  el.style.opacity = String(a);
  el.style.clipPath = `inset(0 ${(1 - reveal) * 100}% 0 0)`;
  const k = el.querySelector('.lt-kicker') as HTMLElement;
  setText(k, kicker); k.style.display = kicker ? '' : 'none';
  setText(el.querySelector('.lt-line')!, line);
}

export function initHud(m: Match, fork: Match | null) {
  const root = document.documentElement.style;
  root.setProperty('--home', m.meta.home.color); root.setProperty('--away', m.meta.away.color);
  setText($('.sb-team.home .short'), m.meta.home.short); setText($('.sb-team.away .short'), m.meta.away.short);
  setText($('#tactics .card-head .home'), m.meta.home.short); setText($('#tactics .card-head .away'), m.meta.away.short);
  if (fork?.meta.forkOf) {
    document.body.classList.add('hasfork');
    const fo = fork.meta.forkOf as any, who = [...m.meta.home.players, ...m.meta.away.players].find((p) => p.id === fo.params?.player);
    const tweak = /\s/.test(fo.tweak) ? fo.tweak : fo.tweak.replace(/_/g, ' ');
    setText($('.wi-text'), `${who ? `${who.num} ${who.name} · ` : ''}${tweak} · ${clock(fo.t)}`);
  }

  const scrub = $<HTMLInputElement>('#scrub');
  scrub.min = String(startTime(m)); scrub.max = String(Math.max(duration(m), fork ? duration(fork) : 0));
  const span = +scrub.max - +scrub.min, pct = (t: number) => `${((t - +scrub.min) / span) * 100}%`;
  const markers = $('#markers');
  for (const e of m.events) {
    if (e.type !== 'goal' && e.type !== 'shot') continue;
    const d = document.createElement('div');
    d.className = `mk ${e.type}`; d.style.left = pct(e.t);
    d.style.setProperty('--team', m.meta[e.team ?? 'home'].color); d.title = `${e.type} ${clock(e.t)}`;
    markers.append(d);
  }
  if (fork?.meta.forkOf) {
    const d = document.createElement('div'); d.className = 'mk fork'; d.style.left = pct(fork.meta.forkOf.t); d.title = 'what if'; markers.append(d);
  }

  const scoreEls = [$('.sb-score .h'), $('.sb-score .a')], score = $('.sb-score');
  const zones = { l: $('#zone-l'), r: $('#zone-r') };
  // goal lower thirds (one per timeline; the fork's lives in the right half in split), stacked above captions
  const goals = [{ el: lowerThird(), match: m, zone: zones.l }];
  if (fork) goals.push({ el: lowerThird(), match: fork, zone: zones.r });
  goals.forEach((g) => g.zone.prepend(g.el));
  const capEls = new Map<string, HTMLElement>();
  return {
    update(s: Snapshot, lens: number, met: Record<Side, TeamMetrics> | undefined, captions: DirectorState['captions'] = {}) {
      root.setProperty('--lens', lens.toFixed(3));
      const split = document.body.classList.contains('split');
      setText($('.sb-clock'), clock(s.t)); setText($('#time'), clock(s.t));
      s.score.forEach((v, i) => setText(scoreEls[i], String(v)));
      if (document.activeElement !== scrub) { scrub.value = String(s.t); }
      scrub.style.setProperty('--p', pct(s.t));
      if (met) for (const side of ['home', 'away'] as Side[]) {
        setText($(`[data-k=label-${side}]`), met[side].label);
        setText($(`[data-k=line-${side}]`), `${met[side].lineHeight.toFixed(1)} m`);
        setText($(`[data-k=cmp-${side}]`), `${met[side].length.toFixed(0)}×${met[side].width.toFixed(0)}`);
      }

      // goal: lower third in the team colour for 5 s + accent rule under the score while it is new
      let goalNow = 0;
      for (const g of goals) {
        const ev = g.match.events.find((e) => e.type === 'goal' && s.t >= e.t && s.t < e.t + 5);
        if (g.zone === zones.r && !split) { g.el.style.display = 'none'; continue; }
        if (!ev) { g.el.style.display = 'none'; continue; }
        const side = ev.team ?? 'home', shot = [...g.match.events].reverse().find((e) => e.type === 'shot' && e.t <= ev.t && e.team === side);
        const p = shot?.idx != null ? g.match.meta[side].players[shot.idx] : null;
        g.el.style.setProperty('--sig', g.match.meta[side].color);
        showLowerThird(g.el, s.t, ev.t, 5, `Goal · ${g.match.meta[side].name} · ${clock(ev.t)}`, p ? `${p.num} ${p.name}` : g.match.meta[side].name);
        if (g.match === m) goalNow = Math.min(1, (s.t - ev.t) / T.base, (ev.t + 5 - s.t) / T.fast);
      }
      score.style.setProperty('--goal', String(Math.max(0, goalNow)));

      // director captions: one lower third per side key ('all' | 'original' | 'whatif'); what-if ones carry the what-if bar
      for (const [key, el] of capEls) if (!captions[key]) el.style.display = 'none';
      for (const [key, c] of Object.entries(captions)) {
        let el = capEls.get(key);
        if (!el) { el = lowerThird(key === 'whatif' ? 'whatif' : ''); capEls.set(key, el); }
        const zone = key === 'whatif' && split ? zones.r : zones.l;
        if (el.parentElement !== zone) zone.append(el);
        showLowerThird(el, s.t, c.t0, c.dur ?? 4, c.title ?? '', c.text);
      }
    },
  };
}
