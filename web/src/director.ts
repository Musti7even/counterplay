// Director: a small JSON cue list (camera cuts, lens ramps, slow-mo, view, selection, captions) keyed on match time.
// evalCues() folds all cues up to t from scratch, so it is scrub-safe and deterministic for the recorder.
// Agents can emit the same JSON; load with ?director=<name> (web/public/directors/<name>.json) or ?cues=<url>.
import type { CamMode } from './cameras';

export type ViewMode = 'single' | 'split' | 'ghost';
export interface Caption { title?: string; text: string; dur?: number }
export interface Cue {
  t: number;                 // match seconds
  cam?: CamMode; cut?: boolean;   // cut = instant, else eased blend
  lens?: number;             // jump to lens value
  lensTo?: number; over?: number; // ramp to lens value over `over` match-seconds
  speed?: number;            // playback rate (0.4 = slow-mo)
  view?: ViewMode;
  select?: string | null;    // player id (e.g. "a6"), null clears
  caption?: Caption | null;  // lower third; null hides
}
export interface Script {
  name?: string; match?: string; fork?: string; from: number; to: number;
  cam?: CamMode; lens?: number; view?: ViewMode; select?: string | null; speed?: number; cues: Cue[];
}
export interface DirectorState {
  cam: CamMode; cut: boolean; lens: number; speed: number; view?: ViewMode; select: string | null | undefined;
  caption: (Caption & { t0: number }) | null;
}

export async function loadScript(q: URLSearchParams): Promise<Script | null> {
  const url = q.get('cues') ?? (q.get('director') ? `/directors/${q.get('director')}.json` : null);
  if (!url) return null;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`director script ${url}: ${res.status}`);
  const s = (await res.json()) as Script;
  s.cues.sort((a, b) => a.t - b.t);
  return s;
}

export function evalCues(s: Script, t: number): DirectorState {
  const st: DirectorState = { cam: s.cam ?? 'broadcast', cut: true, lens: s.lens ?? 0.2, speed: s.speed ?? 1, view: s.view, select: s.select, caption: null };
  let ramp = { t0: -Infinity, from: st.lens, to: st.lens, over: 0 };
  const lensAt = (x: number) => {
    if (x >= ramp.t0 + ramp.over) return ramp.to;
    const u = Math.max(0, (x - ramp.t0) / ramp.over);
    return ramp.from + (ramp.to - ramp.from) * u * u * (3 - 2 * u);
  };
  for (const c of s.cues) {
    if (c.t > t) break;
    if (c.cam) { st.cam = c.cam; st.cut = !!c.cut; }
    if (c.lens != null) ramp = { t0: c.t, from: c.lens, to: c.lens, over: 0 };
    if (c.lensTo != null) ramp = { t0: c.t, from: lensAt(c.t), to: c.lensTo, over: c.over ?? 1.5 };
    if (c.speed != null) st.speed = c.speed;
    if (c.view) st.view = c.view;
    if (c.select !== undefined) st.select = c.select;
    if (c.caption !== undefined) st.caption = c.caption ? { ...c.caption, t0: c.t } : null;
  }
  st.lens = lensAt(t);
  if (st.caption && t > st.caption.t0 + (st.caption.dur ?? 4)) st.caption = null;
  return st;
}
