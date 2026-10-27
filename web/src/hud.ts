// HTML overlay: scorebug, tactical panel, goal banner, timeline markers. Pure DOM updates, no framework.
import { Match, Snapshot, TeamMetrics, Side, clock, duration, startTime } from './data';
import type { DirectorState } from './director';

const $ = <T extends HTMLElement = HTMLElement>(sel: string) => document.querySelector(sel) as T;
const setText = (el: Element, s: string) => { if (el.textContent !== s) el.textContent = s; };

export function initHud(m: Match, fork: Match | null) {
  const root = document.documentElement.style;
  root.setProperty('--home', m.meta.home.color); root.setProperty('--away', m.meta.away.color);
  setText($('.sb-team.home .short'), m.meta.home.short); setText($('.sb-team.away .short'), m.meta.away.short);
  setText($('.tp-teams .home'), m.meta.home.short); setText($('.tp-teams .away'), m.meta.away.short);
  if (fork?.meta.forkOf) {
    document.body.classList.add('hasfork');
    const fo = fork.meta.forkOf as any, who = [...m.meta.home.players, ...m.meta.away.players].find((p) => p.id === fo.params?.player);
    const tweak = /\s/.test(fo.tweak) ? fo.tweak : fo.tweak.replace(/_/g, ' ').toUpperCase();
    setText($('.wi-text'), `${who ? `${who.num} ${who.name.toUpperCase()} · ` : ''}${tweak} @ ${clock(fo.t)}`);
  }

  const scrub = $<HTMLInputElement>('#scrub');
  scrub.min = String(startTime(m)); scrub.max = String(Math.max(duration(m), fork ? duration(fork) : 0));
  const span = +scrub.max - +scrub.min, pct = (t: number) => `${((t - +scrub.min) / span) * 100}%`;
  const markers = $('#markers');
  for (const e of m.events) {
    if (e.type !== 'goal' && e.type !== 'shot') continue;
    const d = document.createElement('div');
    d.className = `mk ${e.type}`; d.style.left = pct(e.t);
    d.style.background = m.meta[e.team ?? 'home'].color; d.title = `${e.type} ${clock(e.t)}`;
    markers.append(d);
  }
  if (fork?.meta.forkOf) {
    const d = document.createElement('div'); d.className = 'mk fork'; d.style.left = pct(fork.meta.forkOf.t); markers.append(d);
  }

  const scoreEls = [$('.sb-score .h'), $('.sb-score .a')];
  const banners = [{ el: $('#banner'), match: m }];
  if (fork) { const el = $('#banner').cloneNode(true) as HTMLElement; el.id = 'banner2'; document.body.append(el); banners.push({ el, match: fork }); }
  const capEls = new Map<string, HTMLElement>();
  let lastScore = '';
  return {
    update(s: Snapshot, lens: number, met: Record<Side, TeamMetrics> | undefined, pressure: number, captions: DirectorState['captions'] = {}) {
      root.setProperty('--lens', lens.toFixed(3));
      setText($('.sb-clock'), clock(s.t)); setText($('#time'), clock(s.t));
      const sc = s.score.join('-');
      if (sc !== lastScore) {
        s.score.forEach((v, i) => { if (lastScore && String(v) !== scoreEls[i].textContent) { scoreEls[i].classList.remove('bump'); void scoreEls[i].offsetWidth; scoreEls[i].classList.add('bump'); } setText(scoreEls[i], String(v)); });
        lastScore = sc;
      }
      if (document.activeElement !== scrub) { scrub.value = String(s.t); }
      scrub.style.setProperty('--p', pct(s.t));
      if (met) for (const side of ['home', 'away'] as Side[]) {
        setText($(`[data-k=label-${side}]`), met[side].label);
        setText($(`[data-k=poss-${side}]`), met[side].inPoss ?? '—');
        setText($(`[data-k=line-${side}]`), `${met[side].lineHeight.toFixed(1)} m`);
        setText($(`[data-k=cmp-${side}]`), `${met[side].length.toFixed(0)}×${met[side].width.toFixed(0)}`);
      }
      setText($('[data-k=press]'), pressure ? `${pressure} WITHIN 5 M` : '—');

      // goal banners: big moment at every lens. Split: each banner lives in the half where its goal happened.
      // Animated from match time (recorder-safe), not CSS transitions.
      for (const { el, match } of banners) {
        const g = match.events.find((e) => e.type === 'goal' && s.t >= e.t && s.t < e.t + 5);
        const ga = g ? Math.min(1, (s.t - g.t) / 0.35, (g.t + 5 - s.t) / 0.35) : 0, ge = 1 - (1 - ga) ** 3;
        el.style.opacity = String(ga); el.style.transform = `translateX(-50%) scaleX(${0.6 + 0.4 * ge})`;
        if (!g) continue;
        const side = g.team ?? 'home', shot = [...match.events].reverse().find((e) => e.type === 'shot' && e.t <= g.t && e.team === side);
        const p = shot?.idx != null ? match.meta[side].players[shot.idx] : null;
        (el.querySelector('.bn-bar') as HTMLElement).style.background = match.meta[side].color;
        setText(el.querySelector('.bn-sub')!, `${match.meta[side].name.toUpperCase()}${p ? `  ·  ${p.num} ${p.name.toUpperCase()}` : ''}  ·  ${clock(g.t)}`);
      }
      // director captions, one lower third per side key ('all' | 'original' | 'whatif')
      for (const [key, el] of capEls) if (!captions[key]) el.style.opacity = '0';
      for (const [key, c] of Object.entries(captions)) {
        let el = capEls.get(key);
        if (!el) { el = $('#caption').cloneNode(true) as HTMLElement; el.id = ''; el.className = `hud caption cap-${key}`; document.body.append(el); capEls.set(key, el); }
        const age = s.t - c.t0, out = (c.dur ?? 4) - age;
        const a = Math.max(0, Math.min(1, age / 0.4, out / 0.4)), e = 1 - (1 - a) ** 3;
        el.style.opacity = String(a); el.style.transform = `translateX(${(1 - e) * -40}px)`;
        const ti = el.querySelector('.cp-title') as HTMLElement;
        setText(ti, c.title ?? ''); ti.style.display = c.title ? '' : 'none'; setText(el.querySelector('.cp-text')!, c.text);
      }
    },
  };
}
