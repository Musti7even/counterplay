// Dev-only mock match generator. Emits ../data/mock.json + ../data/fork-mock.json in data/FORMAT.md shape.
// ponytail: toy kinematics (seek-to-target + scripted decisions); the real engine replaces this.
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = resolve(dirname(fileURLToPath(import.meta.url)), '../../data');
const FPS = 10, DT = 1 / FPS, DURATION = 150;

const FIRST = ['L.', 'M.', 'J.', 'T.', 'K.', 'A.', 'R.', 'D.', 'S.', 'O.', 'E.', 'N.'];
const LAST = ['Okafor', 'Lindqvist', 'Marsh', 'Torres', 'Achterberg', 'Kowal', 'Brennan', 'Haddad', 'Silva', 'Novak', 'Ferreira',
  'Calder', 'Mensah', 'Ishikawa', 'Dupont', 'Varga', 'Holt', 'Quinn', 'Reyes', 'Moreau', 'Baptiste', 'Strand'];

// base shapes in "own half" coordinates for a team attacking +x: [x, y, pos]
const F442 = [[-50, 0, 'GK'], [-36, 25, 'LB'], [-38, 8, 'CB'], [-38, -8, 'CB'], [-36, -25, 'RB'],
  [-22, 24, 'LM'], [-24, 8, 'CM'], [-24, -8, 'CM'], [-22, -24, 'RM'], [-8, 7, 'ST'], [-8, -7, 'ST']];
const F433 = [[-50, 0, 'GK'], [-36, 24, 'LB'], [-38, 8, 'CB'], [-38, -8, 'CB'], [-36, -24, 'RB'],
  [-25, 0, 'DM'], [-20, 14, 'CM'], [-20, -14, 'CM'], [-8, 22, 'LW'], [-6, 0, 'ST'], [-8, -22, 'RW']];
const NUMS = [1, 3, 4, 5, 2, 11, 8, 6, 7, 9, 10];

function rngFrom(seed) {
  return () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const adv = (p, T) => p.x * T.dir;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const r2 = (v) => Math.round(v * 100) / 100;

function simulate({ forkT = Infinity, forkSeed = 0, forceGoal = true }) {
  let rng = rngFrom(7);
  const teams = ['home', 'away'].map((side, ti) => {
    const shape = ti === 0 ? F442 : F433, dir = ti === 0 ? 1 : -1;
    return { side, dir, shape, p: shape.map(([x, y]) => ({ x: x * dir * 0.9, y: y * dir, vx: 0, vy: 0 })) };
  });
  const S = { t: 0, score: [0, 0], poss: 0, owner: 9, ball: { x: 0, y: 0, z: 0 }, flight: null, hold: 1.5, mode: 'kickoff',
    freeze: 1.5, runner: -1, lastShot: -99, goals: 0 };
  teams[0].p[9].x = -0.5; teams[0].p[9].y = 0;
  const frames = [], events = [];
  const ev = (e) => events.push({ t: r2(S.t), ...e });

  const resetKickoff = (team) => {
    for (const T of teams) T.p.forEach((pl, i) => { pl.x = T.shape[i][0] * T.dir * 0.9; pl.y = T.shape[i][1] * T.dir; pl.vx = pl.vy = 0; });
    S.poss = team; S.owner = 9; teams[team].p[9].x = -0.5 * teams[team].dir; teams[team].p[9].y = 0;
    S.ball = { x: 0, y: 0, z: 0 }; S.mode = 'kickoff'; S.freeze = 1.5; S.hold = 1.0;
  };

  const startPass = (to, ok, interceptor) => {
    const T = teams[S.poss], from = T.p[S.owner], recv = ok ? T.p[to] : teams[1 - S.poss].p[interceptor];
    const tx = recv.x + recv.vx * 0.8, ty = recv.y + recv.vy * 0.8;
    const dist = Math.hypot(tx - S.ball.x, ty - S.ball.y), dur = clamp(dist / 17, 0.4, 2.6);
    ev({ type: 'pass', team: T.side, idx: S.owner, toIdx: to, from: [r2(S.ball.x), r2(S.ball.y)], to: [r2(tx), r2(ty)], ok });
    S.flight = { kind: 'pass', x0: S.ball.x, y0: S.ball.y, x1: tx, y1: ty, t0: S.t, dur, h: dist > 28 ? dist * 0.12 : 0.2,
      team: ok ? S.poss : 1 - S.poss, idx: ok ? to : interceptor, ok };
    S.owner = -1;
  };

  const shoot = () => {
    const T = teams[S.poss], goal = forceGoal && S.goals === 0 && S.t > 40 ? true : rng() < 0.1;
    const gy = goal ? (rng() - 0.5) * 5 : (rng() < 0.5 ? 1 : -1) * (4.5 + rng() * 3);
    const x1 = 53.5 * T.dir, dist = Math.hypot(x1 - S.ball.x, gy - S.ball.y);
    ev({ type: 'shot', team: T.side, idx: S.owner, from: [r2(S.ball.x), r2(S.ball.y)], to: [r2(x1), r2(gy)], ok: goal });
    S.flight = { kind: 'shot', x0: S.ball.x, y0: S.ball.y, x1, y1: gy, t0: S.t, dur: dist / 26, h: 1.6, goal, team: S.poss };
    S.owner = -1; S.lastShot = S.t;
  };

  for (let step = 0; step <= DURATION * FPS; step++) {
    S.t = step * DT;
    if (S.t >= forkT && !S.forked) { rng = rngFrom(forkSeed); S.forked = true; }
    const att = teams[S.poss], def = teams[1 - S.poss];

    // --- decisions
    if (S.freeze > 0) {
      S.freeze -= DT;
      if (S.freeze <= 0 && S.mode === 'goal') resetKickoff(S.afterGoal);
      else if (S.freeze <= 0) S.mode = 'play';
    } else if (S.flight) {
      const f = S.flight, s = (S.t - f.t0) / f.dur;
      if (s >= 1) {
        S.flight = null;
        if (f.kind === 'shot') {
          if (f.goal) { S.score[f.team]++; S.goals++; ev({ type: 'goal', team: teams[f.team].side, idx: -1 });
            S.mode = 'goal'; S.freeze = 4; S.afterGoal = 1 - f.team; S.ball = { x: f.x1 + Math.sign(f.x1) * 1.2, y: f.y1, z: 0.3 }; }
          else { ev({ type: 'out', team: teams[f.team].side }); S.poss = 1 - f.team; S.owner = 0; S.mode = 'goalkick'; S.freeze = 2;
            const gk = teams[S.poss].p[0]; gk.x = -47 * teams[S.poss].dir; gk.y = 0; S.hold = 1.2; }
        } else {
          if (!f.ok) { ev({ type: 'interception', team: teams[f.team].side, idx: f.idx }); S.runner = -1; }
          S.poss = f.team; S.owner = f.idx; S.hold = 0.8 + rng() * 2.2;
        }
      }
    } else if (S.owner >= 0) {
      S.hold -= DT;
      const o = att.p[S.owner], adv = o.x * att.dir;
      const tackler = def.p.findIndex((p, i) => i && Math.hypot(p.x - o.x, p.y - o.y) < 1.4);
      if (tackler > 0 && S.hold < 0.6 && rng() < 0.25) {
        ev({ type: 'tackle', team: def.side, idx: tackler }); S.poss = 1 - S.poss; S.owner = tackler; S.hold = 1 + rng(); S.runner = -1;
      } else if (adv > 29 && Math.abs(o.y) < 18 && S.t - S.lastShot > 15 && S.owner !== 0) shoot();
      else if (S.hold <= 0) {
        // weighted pick: forward options preferred
        const opts = att.p.map((p, i) => ({ i, w: i === S.owner || i === 0 ? 0 : Math.max(0.2, 1 + (p.x - o.x) * att.dir / 15) / (1 + Math.hypot(p.x - o.x, p.y - o.y) / 30) }));
        let r = rng() * opts.reduce((a, b) => a + b.w, 0), pick = opts.find((op) => (r -= op.w) <= 0)?.i ?? 9;
        if (S.runner >= 0 && rng() < 0.5) pick = S.runner;
        const intercept = rng() < 0.15;
        let ic = 1, best = 1e9;
        def.p.forEach((p, i) => { const d = Math.hypot(p.x - (o.x + att.p[pick].x) / 2, p.y - (o.y + att.p[pick].y) / 2); if (i && d < best) { best = d; ic = i; } });
        startPass(pick, !intercept, ic);
      }
      // occasionally launch a run in behind
      if (S.runner < 0 && adv > -15 && rng() < 0.02) S.runner = [9, 10, 8, 5][Math.floor(rng() * 4)];
    }

    // --- movement targets
    const bx = S.flight ? S.flight.x1 : S.ball.x, by = S.flight ? S.flight.y1 : S.ball.y;
    const pressers = def.p.map((p, i) => ({ i, d: Math.hypot(p.x - bx, p.y - by) })).filter((q) => q.i).sort((a, b) => a.d - b.d);
    for (const [ti, T] of teams.entries()) {
      const inPoss = ti === S.poss;
      T.p.forEach((pl, i) => {
        let tx, ty, vmax = 6.2;
        const [fx, fy] = T.shape[i];
        if (i === 0) { tx = (-50 + clamp((bx * T.dir + 52) * 0.12, 0, 10)) * T.dir; ty = by * 0.12; }
        else {
          const shift = clamp(bx * T.dir, -30, 30) * 0.6 + (inPoss ? 10 : -2);
          tx = (fx * 0.72 + 14 + shift) * T.dir;
          ty = fy * (inPoss ? 1.08 : 0.78) + by * 0.28;
          const ph = i * 1.7 + ti * 4;
          tx += Math.sin(S.t * 0.35 + ph) * 2.5; ty += Math.cos(S.t * 0.27 + ph) * 2.5;
        }
        if (S.freeze > 0 && S.mode === 'kickoff') { tx = pl.x; ty = pl.y; }
        if (inPoss && i === S.owner && !S.flight && S.freeze <= 0) {
          tx = pl.x + 6 * T.dir; ty = pl.y * 0.97 + Math.sin(S.t * 0.8 + i) * 1.5; vmax = adv(pl, T) > 20 ? 3.2 : 5.0;
        }
        if (inPoss && i === S.runner && S.owner !== i) {
          const lastLine = Math.max(...teams[1 - ti].p.slice(1).map((p) => p.x * T.dir));
          tx = (lastLine + 4) * T.dir; ty = pl.y * 0.9; vmax = 9.0;
        }
        if (!inPoss && S.freeze <= 0 && (i === pressers[0].i || (i === pressers[1].i && pressers[1].d < 14))) {
          tx = bx; ty = by; vmax = i === pressers[0].i ? 7.2 : 5.5;
        }
        if (S.flight && S.flight.idx === i && S.flight.team === ti) { tx = S.flight.x1; ty = S.flight.y1; vmax = 8; }
        tx = clamp(tx, -52, 52); ty = clamp(ty, -33.5, 33.5);
        const dx = tx - pl.x, dy = ty - pl.y, d = Math.hypot(dx, dy);
        const want = Math.min(vmax, d * 1.2), ux = d > 1e-3 ? dx / d : 0, uy = d > 1e-3 ? dy / d : 0;
        const ax = ux * want - pl.vx, ay = uy * want - pl.vy, am = Math.hypot(ax, ay), k = Math.min(1, (4.5 * DT) / (am || 1));
        pl.vx += ax * k; pl.vy += ay * k; pl.x += pl.vx * DT; pl.y += pl.vy * DT;
      });
    }
    if (S.runner >= 0 && Math.random && att.p[S.runner] && Math.abs(att.p[S.runner].x) > 45) S.runner = -1;

    // --- ball
    if (S.flight) {
      const f = S.flight, s = clamp((S.t - f.t0) / f.dur, 0, 1);
      S.ball = { x: f.x0 + (f.x1 - f.x0) * s, y: f.y0 + (f.y1 - f.y0) * s, z: 4 * f.h * s * (1 - s) + (f.kind === 'shot' ? s * 0.8 : 0.11) };
    } else if (S.owner >= 0 && S.mode !== 'goal') {
      const o = teams[S.poss].p[S.owner], sp = Math.hypot(o.vx, o.vy);
      S.ball = { x: o.x + (sp > 0.5 ? o.vx / sp : teams[S.poss].dir) * 0.8, y: o.y + (sp > 0.5 ? o.vy / sp : 0) * 0.8, z: 0.11 };
    }

    frames.push({
      t: r2(S.t), ball: [r2(S.ball.x), r2(S.ball.y), r2(S.ball.z)],
      home: teams[0].p.map((p) => [r2(p.x), r2(p.y)]), away: teams[1].p.map((p) => [r2(p.x), r2(p.y)]),
      owner: S.owner >= 0 && !S.flight ? { team: teams[S.poss].side, idx: S.owner } : null,
      mode: S.freeze > 0 ? (S.mode === 'goal' ? 'kickoff' : S.mode) : 'play', score: [...S.score],
    });
  }
  return { frames, events };
}

const team = (name, short, color, shape, off) => ({ name, short, color,
  players: shape.map((s, i) => ({ id: `${short.toLowerCase()}${i + 1}`, num: NUMS[i], name: `${FIRST[(i + off) % 12]} ${LAST[(i * 3 + off) % 22]}`, pos: s[2] })) });
const meta = { fps: FPS, pitch: { length: 105, width: 68 },
  home: team('Redmoor FC', 'RED', '#d7263d', F442, 0), away: team('Harbour Athletic', 'HBA', '#2e86de', F433, 5), forkOf: null };

const orig = simulate({});
const goal = orig.events.find((e) => e.type === 'goal');
const forkT = Math.round(((goal?.t ?? 60) - 7) * 10) / 10;
const fork = simulate({ forkT, forkSeed: 99, forceGoal: false });
mkdirSync(OUT, { recursive: true });
writeFileSync(`${OUT}/mock.json`, JSON.stringify({ meta, ...orig }));
writeFileSync(`${OUT}/fork-mock.json`, JSON.stringify({
  meta: { ...meta, forkOf: { match: 'mock', t: forkT, tweak: 'Harbour back four holds a deeper line' } },
  frames: fork.frames.filter((f) => f.t >= forkT), events: fork.events.filter((e) => e.t >= forkT),
}));
console.log(`mock.json: ${orig.frames.length} frames, ${orig.events.length} events, goal at ${goal?.t}; fork-mock.json from t=${forkT}`);
