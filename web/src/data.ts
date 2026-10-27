// Match data contract (see data/FORMAT.md), sampling with smooth interpolation, and derived tactics.
export type Side = 'home' | 'away';
export type V2 = [number, number];
export interface PlayerMeta { id: string; num: number; name: string; pos: string }
export interface TeamMeta { name: string; short: string; color: string; players: PlayerMeta[] }
export interface Meta {
  fps: number; pitch: { length: number; width: number }; home: TeamMeta; away: TeamMeta;
  forkOf: null | { match: string; t: number; tweak: string };
}
export interface Frame {
  t: number; ball: [number, number, number]; home: V2[]; away: V2[];
  owner: { team: Side; idx: number } | null; mode: string; score: [number, number];
}
export interface MatchEvent {
  t: number; type: string; team?: Side; idx?: number; toIdx?: number; from?: V2; to?: V2; ok?: boolean;
  dur?: number; // derived: flight time for pass/shot
}
export interface Match { meta: Meta; frames: Frame[]; events: MatchEvent[]; name: string; shapes: Record<Side, string[]> }

export const SIDES: Side[] = ['home', 'away'];
export const dirOf = (s: Side) => (s === 'home' ? 1 : -1); // home attacks +x
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

export async function loadMatch(name: string): Promise<Match> {
  const res = await fetch(`/data/${name}.json`);
  if (!res.ok) throw new Error(`/data/${name}.json: ${res.status}`);
  const m = (await res.json()) as Match;
  m.name = name;
  return prepare(m);
}

// Fork files may carry only the frames after the fork point: prefix them with the original.
export function mergeFork(orig: Match, fork: Match): Match {
  const t0 = fork.frames[0].t;
  return prepare({ ...fork, frames: [...orig.frames.filter((f) => f.t < t0), ...fork.frames],
    events: [...orig.events.filter((e) => e.t < t0), ...fork.events] });
}

function prepare(m: Match): Match {
  m.frames.sort((a, b) => a.t - b.t);
  m.events.sort((a, b) => a.t - b.t);
  for (const e of m.events) if (e.type === 'pass' || e.type === 'shot') e.dur = flightTime(m, e);
  m.shapes = { home: m.frames.map((f) => shapeOf(m, f, 'home').label), away: m.frames.map((f) => shapeOf(m, f, 'away').label) };
  return m;
}

// Ball travel time for a pass/shot: until someone owns the ball again (or play stops).
function flightTime(m: Match, e: MatchEvent) {
  const i0 = frameIndex(m, e.t) + 1;
  for (let i = i0; i < m.frames.length && i < i0 + 40; i++) {
    const f = m.frames[i];
    if (f.owner || f.mode !== 'play') return clamp(f.t - e.t, 0.3, 3);
  }
  const d = e.from && e.to ? Math.hypot(e.to[0] - e.from[0], e.to[1] - e.from[1]) : 20;
  return clamp(d / 17, 0.3, 3);
}

export const duration = (m: Match) => m.frames[m.frames.length - 1].t;
export const startTime = (m: Match) => m.frames[0].t;
export function frameIndex(m: Match, t: number) {
  const f = m.frames, i = Math.floor((t - f[0].t) * m.meta.fps);
  return clamp(i, 0, f.length - 1);
}

// Catmull-Rom between 10 fps samples; falls back to linear across teleports (kick-off resets).
function cr(p0: number, p1: number, p2: number, p3: number, s: number) {
  const s2 = s * s, s3 = s2 * s;
  return 0.5 * (2 * p1 + (-p0 + p2) * s + (2 * p0 - 5 * p1 + 4 * p2 - p3) * s2 + (-p0 + 3 * p1 - 3 * p2 + p3) * s3);
}
function interp(a: number[], b: number[], c: number[], d: number[], s: number, k: number) {
  const jump = Math.abs(c[k] - b[k]) > 5 || Math.abs(b[k] - a[k]) > 5 || Math.abs(d[k] - c[k]) > 5;
  return jump ? (s < 0.5 ? b[k] : c[k]) : cr(a[k], b[k], c[k], d[k], s);
}

export interface Snapshot {
  t: number; ball: [number, number, number]; pos: Record<Side, V2[]>; vel: Record<Side, V2[]>;
  owner: Frame['owner']; score: [number, number]; mode: string; frame: Frame;
}

export function positionsAt(m: Match, t: number): { ball: [number, number, number]; pos: Record<Side, V2[]> } {
  const F = m.frames, ft = (t - F[0].t) * m.meta.fps, i = clamp(Math.floor(ft), 0, F.length - 1), s = clamp(ft - i, 0, 1);
  const a = F[Math.max(0, i - 1)], b = F[i], c = F[Math.min(F.length - 1, i + 1)], d = F[Math.min(F.length - 1, i + 2)];
  const ball = [0, 1, 2].map((k) => interp(a.ball, b.ball, c.ball, d.ball, s, k)) as [number, number, number];
  const pos = {} as Record<Side, V2[]>;
  for (const side of SIDES)
    pos[side] = b[side].map((_, j) => [0, 1].map((k) => interp(a[side][j], b[side][j], c[side][j], d[side][j], s, k)) as V2);
  return { ball, pos };
}

export function snapshot(m: Match, t: number): Snapshot {
  const now = positionsAt(m, t), prev = positionsAt(m, t - 0.15), next = positionsAt(m, t + 0.15);
  const vel = {} as Record<Side, V2[]>;
  for (const side of SIDES)
    vel[side] = now.pos[side].map((_, j) => {
      const vx = (next.pos[side][j][0] - prev.pos[side][j][0]) / 0.3, vy = (next.pos[side][j][1] - prev.pos[side][j][1]) / 0.3;
      return Math.hypot(vx, vy) > 12 ? [0, 0] : [vx, vy]; // teleport guard
    });
  const frame = m.frames[frameIndex(m, t + 0.05)];
  return { t, ...now, vel, owner: frame.owner, score: frame.score, mode: frame.mode, frame };
}

// ---------- tactics ----------
export interface Shape { label: string; lines: number[][]; gk: number; def: number[] }

const DEF = /^(CB|LB|RB|LWB|RWB|SW|DEF|D)$/i, FWD = /^(CF|ST|LW|RW|SS|FW|F)$/i;
// Units from listed roles (DEF/MID/FWD); live depth moves a player into a neighbouring unit (e.g. 4-4-2 -> 5-3-2).
// ponytail: role-seeded; no role metadata -> falls back to depth groups of 4/4/2.
export function shapeOf(m: Match, f: { home: V2[]; away: V2[] }, side: Side): Shape {
  const d = dirOf(side), P = f[side], metaP = m.meta[side].players;
  let gk = metaP.findIndex((p) => p.pos === 'GK');
  if (gk < 0) gk = P.reduce((best, p, i) => (p[0] * d < P[best][0] * d ? i : best), 0);
  const out = P.map((p, i) => ({ i, depth: p[0] * d, role: metaP[i]?.pos ?? '' })).filter((o) => o.i !== gk);
  const unit = (r: string) => (DEF.test(r) ? 0 : FWD.test(r) ? 2 : 1);
  let groups = [0, 1, 2].map((u) => out.filter((o) => unit(o.role) === u)).filter((g) => g.length);
  if (groups.length < 2) { const s = [...out].sort((a, b) => a.depth - b.depth); groups = [s.slice(0, 4), s.slice(4, 8), s.slice(8)]; }
  const def = groups[0].map((o) => o.i);
  // a player joins the neighbouring unit only once he is past that unit's average depth (dropped / pushed on)
  const cents = groups.map((g) => g.reduce((a, o) => a + o.depth, 0) / g.length);
  const lines: number[][] = groups.map(() => []);
  groups.forEach((g, u) => g.forEach((o) => {
    const v = u + 1 < cents.length && o.depth > cents[u + 1] + 3 ? u + 1 : u > 0 && o.depth < cents[u - 1] - 3 ? u - 1 : u;
    lines[v].push(o.i);
  }));
  for (let k = lines.length - 1; k >= 0; k--) if (!lines[k].length) lines.splice(k, 1);
  return { label: lines.map((l) => l.length).join('-'), lines, gk, def };
}

// Most common label over the last few seconds, so the on-screen formation doesn't flicker.
export function stableShape(m: Match, side: Side, t: number, window = 6) {
  const i1 = frameIndex(m, t), i0 = Math.max(0, i1 - Math.round(window * m.meta.fps)), count = new Map<string, number>();
  for (let i = i0; i <= i1; i += 2) count.set(m.shapes[side][i], (count.get(m.shapes[side][i]) ?? 0) + 1);
  return [...count.entries()].sort((a, b) => b[1] - a[1])[0][0];
}

export interface TeamMetrics { shape: Shape; label: string; lineHeight: number; length: number; width: number; offsideX: number }
export function metrics(m: Match, s: Snapshot, side: Side): TeamMetrics {
  const d = dirOf(side), P = s.pos[side], shape = shapeOf(m, s.pos, side);
  const out = P.filter((_, i) => i !== shape.gk), depth = (p: V2) => p[0] * d + 52.5;
  const back = shape.def.map((i) => depth(P[i]));
  const lineHeight = back.reduce((a, b) => a + b, 0) / back.length;
  const xs = out.map(depth), ys = out.map((p) => p[1]);
  // offside line: second-last defender, never beyond halfway, never behind the ball
  const sorted = P.map(depth).sort((a, b) => a - b), ballDepth = s.ball[0] * d + 52.5;
  const offDepth = Math.min(sorted[1], 52.5, Math.max(ballDepth, 0));
  return {
    shape, label: stableShape(m, side, s.t), lineHeight,
    length: Math.max(...xs) - Math.min(...xs), width: Math.max(...ys) - Math.min(...ys),
    offsideX: (offDepth - 52.5) * d,
  };
}

export function convexHull(pts: V2[]): V2[] {
  const p = [...pts].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o: V2, a: V2, b: V2) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo: V2[] = [], up: V2[] = [];
  for (const q of p) { while (lo.length > 1 && cross(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop(); lo.push(q); }
  for (const q of p.reverse()) { while (up.length > 1 && cross(up[up.length - 2], up[up.length - 1], q) <= 0) up.pop(); up.push(q); }
  return lo.slice(0, -1).concat(up.slice(0, -1));
}

export const clock = (t: number) => `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
