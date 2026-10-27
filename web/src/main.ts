import './tokens.css';
import './style.css';
import { C, LINE } from './tokens';
import * as THREE from 'three';
import { Match, Side, loadMatch, mergeFork, snapshot, positionsAt, duration, startTime, clock } from './data';
import { buildStadium, makeComposer, toWorld } from './scene';
import { Players } from './players';
import { Graphics, Ribbon } from './graphics';
import { CameraRig, CamMode } from './cameras';
import { initHud } from './hud';
import { loadScript, evalCues, ViewMode, Script } from './director';
import { Overlay, loadCommentary, Variant, PlayerCard } from './overlay';
import { ControlStrip, loadTrace } from './control';

const q = new URLSearchParams(location.search);

class View {
  el = document.createElement('div');
  renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance', preserveDrawingBuffer: true });
  scene = new THREE.Scene();
  cam = new THREE.PerspectiveCamera(24, 16 / 9, 0.5, 600);
  rig = new CameraRig(this.cam);
  post: ReturnType<typeof makeComposer>;
  players: Players; gfx: Graphics; ghosts: Players | null = null;
  label: HTMLElement;
  // per-view lens/cam/selection: the shared global state, except in quad where each quadrant has its own
  vs: { lens: number; cam: CamMode; selected: { side: Side; idx: number } | null } = state;
  overlay?: Overlay;
  // selected player's path since the fork: [original (white), what-if (alternate timeline colour)]
  paths = [new Ribbon(LINE.primary, new THREE.Color(C.text), 160), new Ribbon(LINE.primary, new THREE.Color(C.whatif), 160)];

  // lite: multi-view budget (pixel ratio 1, 2x MSAA, 1024 shadow map)
  constructor(public match: Match, labelText: string, ghostOf: Match | null, public whatIf = false, public lite = false) {
    this.post = makeComposer(this.renderer, this.scene, this.cam, lite ? 2 : 4);
    this.el.className = 'view';
    this.el.append(this.renderer.domElement);
    this.label = document.createElement('div');
    this.label.className = `badge view-label ${whatIf ? 'whatif' : 'neutral'}`;
    this.label.innerHTML = `<span class="vl-name">${labelText}</span><span class="bd-v vl-score"></span>`;
    this.el.append(this.label);
    this.wipe.className = 'wipe'; this.wipe.innerHTML = '<span>KICK-OFF</span>'; this.el.append(this.wipe);
    this.renderer.shadowMap.enabled = true; this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.toneMapping = THREE.NoToneMapping;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    buildStadium(this.renderer, this.scene, [match.meta.home.name, match.meta.away.name], lite);
    this.players = new Players(match); this.gfx = new Graphics(match);
    this.scene.add(this.players.group, this.gfx.group, ...this.paths.map((p) => p.mesh));
    if (ghostOf) { this.ghosts = new Players(ghostOf, true); this.scene.add(this.ghosts.group); }
    this.renderer.domElement.addEventListener('click', (ev) => this.pick(ev));
  }

  resize() {
    const w = this.el.clientWidth, h = this.el.clientHeight, dpr = Math.min(devicePixelRatio, this.lite ? 1 : 1.5);
    this.renderer.setPixelRatio(dpr); this.renderer.setSize(w, h, false);
    this.post.composer.setPixelRatio(dpr); this.post.composer.setSize(w, h);
    this.cam.aspect = w / h; this.cam.updateProjectionMatrix();
  }

  pick(ev: MouseEvent) {
    const r = this.renderer.domElement.getBoundingClientRect(), ray = new THREE.Raycaster();
    ray.setFromCamera(new THREE.Vector2(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1), this.cam);
    const hit = ray.intersectObject(this.players.group, true).find((h) => h.object.userData.figureRoot);
    this.vs.selected = hit ? hit.object.userData.figureRoot.userData.pick : null;
  }

  wipe = document.createElement('div');
  private lastT = -1;

  // camBall: what the rig follows (split: midpoint of both balls); camFrom: copy another view's camera (identical pose)
  render(t: number, dt: number, now: number, showGhost: boolean, o: { camBall?: [number, number, number]; camFrom?: THREE.PerspectiveCamera; tight?: boolean } = {}) {
    const s = snapshot(this.match, t);
    // kickoff snaps (GRF teleports players after a goal): hide under a quick branded wipe, cut the camera under it
    // covered by c-0.06 (interp swaps samples at the midpoint), held briefly, gone by c+0.45
    const cut = this.match.cuts.find((c) => t > c - 0.2 && t < c + 0.45);
    const x = cut == null ? null : t < cut - 0.06 ? -1 + (t - cut + 0.2) / 0.14 : t < cut + 0.15 ? 0 : (t - cut - 0.15) / 0.3;
    this.wipe.style.transform = x == null ? 'translateX(-200%)' : `translateX(${x * 135}%) skewX(-14deg)`;
    if (this.match.cuts.some((c) => this.lastT < c && t >= c)) this.rig.snap();
    this.lastT = t;
    this.players.update(s, dt);
    if (this.ghosts) {
      const fs = snapshot(this.ghosts.match, t), on = showGhost && t >= forkT;
      this.ghosts.group.visible = on;
      if (on) this.ghosts.update(fs, dt, s);
    }
    const sel = this.vs.selected, after = t > forkT;
    const trail = (m: Match, r: Ribbon, on: boolean) => {
      if (!on || !sel) return r.set([], 0);
      const t0 = Math.max(forkT - 1, t - 14), n = Math.max(2, Math.min(150, Math.ceil((t - t0) / 0.1)));
      const pts = Array.from({ length: n + 1 }, (_, k) => { const [x, y] = positionsAt(m, t0 + ((t - t0) * k) / n).pos[sel.side][sel.idx]; return toWorld(x, y, 0.06); });
      r.set(pts, 0.9);
    };
    trail(this.match, this.paths[this.whatIf ? 1 : 0], after);
    if (!this.whatIf) trail(this.ghosts?.match ?? this.match, this.paths[1], after && !!this.ghosts?.group.visible);
    if (o.camFrom) {
      this.cam.position.copy(o.camFrom.position); this.cam.quaternion.copy(o.camFrom.quaternion);
      this.cam.fov = o.camFrom.fov; this.cam.updateProjectionMatrix(); this.cam.updateMatrixWorld();
    } else {
      this.rig.tight = !!o.tight;
      this.rig.update(o.camBall ? { ...s, ball: o.camBall } : s, this.vs.cam === 'player' ? this.vs.selected : null, dt);
    }
    this.gfx.update(s, { lens: this.vs.lens, selected: this.vs.selected, now, dt, cam: this.cam });
    this.post.grade.uniforms.desat.value = this.vs.lens * 0.22;
    this.post.grade.uniforms.vignette.value = 0.3 + this.vs.lens * 0.1;
    this.post.composer.render(dt);
    (this.label.querySelector('.vl-score') as HTMLElement).textContent = s.score.join(' – ');
    return s;
  }
}

const state = {
  t: 0, playing: q.get('paused') !== '1', speed: +(q.get('speed') ?? 1),
  lens: +(q.get('lens') ?? 0.2), lensTarget: +(q.get('lens') ?? 0.2),
  cam: (q.get('cam') ?? 'broadcast') as CamMode, selected: null as { side: Side; idx: number } | null,
  view: 'single' as ViewMode,
};
let forkT = Infinity;
const capture = q.get('capture') === '1'; // recorder drives time via demo.step(); no realtime clock

async function main() {
  await Promise.all(['500', '700', '800'].map((w) => document.fonts.load(`${w} 40px "Onest"`)));
  // "?" help overlay (button + key), everywhere
  const help = document.getElementById('help')!;
  document.getElementById('help-btn')!.onclick = () => help.classList.toggle('show');
  help.onclick = (e) => { if (e.target === help) help.classList.remove('show'); };
  addEventListener('keydown', (e) => { if (e.key === '?') help.classList.toggle('show'); else if (e.key === 'Escape') help.classList.remove('show'); });
  if (q.get('view') === 'quad') return quad();
  const script = await loadScript(q);
  // agent run outputs: /data/<run>.cues.json has siblings <run>.commentary.json and <run>.trace.json
  const run = q.get('cues')?.match(/(?:^|\/)data\/([^/]+)\.cues\.json$/)?.[1];
  const comUrl = q.get('commentary') ?? (run ? `data/${run}.commentary.json` : null);
  const commentary = comUrl && q.get('commentary') !== '0' ? await loadCommentary(comUrl).catch(() => null) : null;
  const traceUrl = q.get('control') === '1' ? (run ? `data/${run}.trace.json` : null) : q.get('control');
  const name = q.get('match') ?? script?.match ?? 'match';
  const orig = await loadMatch(name).catch(() => (q.get('match') || script?.match ? Promise.reject(new Error(`could not load /data/${name}.json`)) : loadMatch('mock')));
  const forkName = q.get('fork') ?? script?.fork;
  const forkRaw = forkName ? await loadMatch(forkName) : null;
  const fork = forkRaw ? mergeFork(orig, forkRaw) : null;
  forkT = fork?.meta.forkOf?.t ?? forkRaw?.frames[0].t ?? Infinity;
  state.view = fork ? ((q.get('view') as ViewMode) ?? script?.view ?? 'split') : 'single';
  // loop window: the director's take, else the what-if story window (GRF diverges into noise later)
  // landing (cold open, no params): the opener plays behind the start screen
  const landing = !location.search && !capture;
  if (landing) { document.body.classList.add('landing'); state.lens = state.lensTarget = 0.3; }
  const win = landing ? [58, 72] : script ? [script.from, script.to] : fork && q.get('loop') !== '0' ? [Math.max(startTime(orig), forkT - 5), forkT + 10] : null;
  state.t = q.has('t') ? +q.get('t')! : win ? win[0] : startTime(orig);
  const selectId = (id: string | null | undefined) => {
    state.selected = null;
    if (id) for (const side of ['home', 'away'] as Side[]) {
      const idx = orig.meta[side].players.findIndex((p) => p.id === id);
      if (idx >= 0) state.selected = { side, idx };
    }
  };
  selectId((fork?.meta.forkOf as any)?.params?.player);

  const viewsEl = document.getElementById('views')!;
  const main = new View(orig, 'ORIGINAL', fork, false, !!fork);
  const alt = fork ? new View(fork, 'What if', null, true, true) : null;
  viewsEl.append(main.el);
  if (alt) viewsEl.append(alt.el);
  const hud = initHud(orig, fork);
  // split: the what-if label carries the change itself (the strap would repeat it right below)
  if (alt) alt.label.querySelector('.vl-name')!.insertAdjacentHTML('afterend', `<span class="vl-change">${document.querySelector('.wi-text')!.textContent}</span>`);
  const end = Math.max(duration(orig), fork ? duration(fork) : 0);
  const subs = commentary ? new Overlay(document.body, { commentary, audio: true }) : null;
  subs?.root.classList.add('ov-fixed');
  if (subs) document.body.classList.add('has-subs');
  let control: ControlStrip | null = null;
  if (traceUrl) {
    const ca = q.get('controlAt')?.split('-').map(Number);
    const w0 = win?.[0] ?? state.t, w1 = win?.[1] ?? w0 + 12;
    control = new ControlStrip(await loadTrace(traceUrl), ca?.length === 2 ? [ca[0], ca[1]] : [w0 + 0.5, w0 + Math.min(9, (w1 - w0) * 0.7)]);
  }

  const applyView = () => {
    if (alt) alt.el.style.display = state.view === 'split' ? '' : 'none';
    document.body.classList.toggle('split', state.view === 'split');
    document.querySelectorAll<HTMLButtonElement>('#viewmode button').forEach((b) => b.classList.toggle('on', b.dataset.view === state.view));
    (main.label.querySelector('.vl-name') as HTMLElement).textContent = state.view === 'ghost' ? 'Original · what-if ghosts' : 'Original';
    document.body.classList.toggle('multi', state.view !== 'single');
    [main, alt].forEach((v) => v?.resize()); // sync: the recorder captures right after
  };
  const setCam = (c: CamMode, instant = false) => {
    state.cam = c; [main, alt].forEach((v) => v?.rig.set(c, instant));
    document.querySelectorAll<HTMLButtonElement>('#cams button').forEach((b) => b.classList.toggle('on', b.dataset.cam === c));
  };
  const setPlaying = (p: boolean) => { state.playing = p; document.getElementById('play')!.textContent = p ? '❚❚' : '▶'; };

  // controls
  document.querySelectorAll<HTMLButtonElement>('#cams button').forEach((b) => (b.onclick = () => setCam(b.dataset.cam as CamMode)));
  document.querySelectorAll<HTMLButtonElement>('#viewmode button').forEach((b) => (b.onclick = () => { state.view = b.dataset.view as ViewMode; applyView(); }));
  document.getElementById('play')!.onclick = () => setPlaying(!state.playing);
  const scrub = document.getElementById('scrub') as HTMLInputElement;
  scrub.oninput = () => { state.t = +scrub.value; };
  const speed = document.getElementById('speed') as HTMLSelectElement;
  speed.value = String(state.speed); speed.onchange = () => (state.speed = +speed.value);
  const lens = document.getElementById('lens') as HTMLInputElement;
  lens.value = String(state.lensTarget); lens.oninput = () => (state.lensTarget = +lens.value);
  addEventListener('keydown', (e) => {
    if (e.target instanceof HTMLInputElement && e.key !== ' ') return;
    const k = e.key.toLowerCase();
    if (k === ' ') { e.preventDefault(); setPlaying(!state.playing); }
    else if (k === '1' || k === '2' || k === '3') setCam((['broadcast', 'tactical', 'player'] as CamMode[])[+k - 1]);
    else if (k === 'arrowleft' || k === 'arrowright') state.t += k === 'arrowleft' ? -5 : 5;
    else if (k === 'c') { state.lensTarget = 0; lens.value = '0'; }
    else if (k === 't') { state.lensTarget = 1; lens.value = '1'; }
    else if (k === 'h') document.body.classList.toggle('noui');
    else if (k === 'escape') state.selected = null;
    else if (k === 'f' && fork) { state.t = Math.max(startTime(orig), forkT - 5); }
    else if (k === 's' && fork) { state.view = 'split'; applyView(); }
    else if (k === 'g' && fork) { state.view = 'ghost'; applyView(); }
    else if (k === 'm' && fork) { state.view = 'single'; applyView(); }
  });
  if (q.get('ui') === '0' || capture) document.body.classList.add('noui');
  if (capture) document.body.classList.add('capture');
  if (q.has('sel')) { const [side, idx] = q.get('sel')!.split(':'); state.selected = { side: side as Side, idx: +idx }; }
  addEventListener('resize', () => [main, alt].forEach((v) => v?.resize()));

  setCam(state.cam, true); setPlaying(state.playing); applyView();
  [main, alt].forEach((v) => { v?.rig.snap(); });

  let lastT = state.t, frames = 0, lastSel: string | null | undefined = undefined;
  const tick = (dt: number, now: number) => {
    if (state.playing) state.t += dt * state.speed;
    if (win && !capture && state.playing && state.t > win[1]) state.t = win[0];
    if (state.t >= end) { state.t = end; setPlaying(false); }
    state.t = Math.max(startTime(orig), state.t);
    const jumped = Math.abs(state.t - lastT) > 1;
    lastT = state.t;
    let captions = {};
    if (script) {
      const d = evalCues(script, state.t);
      if (d.cam !== state.cam) setCam(d.cam, d.cut || jumped);
      if (d.view && fork && d.view !== state.view) { state.view = d.view; applyView(); }
      if (d.select !== lastSel) { lastSel = d.select; if (d.select !== undefined) selectId(d.select); }
      state.speed = d.speed; state.lens = state.lensTarget = d.lens; lens.value = String(d.lens);
      captions = d.captions;
    } else state.lens += (state.lensTarget - state.lens) * (1 - Math.exp(-dt * 5));
    if (jumped) [main, alt].forEach((v) => v?.rig.snap());
    const split = !!alt && state.view === 'split';
    let camBall: [number, number, number] | undefined;
    if (split) { // one shared camera: follow the midpoint of both balls so the only difference is the play
      const a = snapshot(orig, state.t).ball, b = snapshot(fork!, state.t).ball;
      camBall = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, 0];
    }
    const s = main.render(state.t, dt, now, state.view === 'ghost', { camBall, tight: split });
    if (split) alt!.render(state.t, dt, now, false, { camFrom: main.cam });
    hud.update(s, state.lens, main.gfx.last, captions);
    subs?.update(s, null, undefined, state.playing && !capture);
    control?.update(state.t);
    (window as any).__frames = ++frames;
  };

  let clockNow = 0;
  Object.assign(window, {
    demo: {
      state, setCam, clock, window: win, audio: commentary?.voice ?? [],
      seek(t: number) { state.t = t; lastT = t; setPlaying(true); [main, alt].forEach((v) => v?.rig.snap()); tick(0, clockNow); },
      step(dt: number) { clockNow += dt; tick(dt, clockNow); return state.t; },
    },
  });
  if (capture) { tick(0, 0); (window as any).__ready = true; return; }
  let last = performance.now();
  const loop = (now: number) => {
    const dt = Math.min(0.1, (now - last) / 1000); last = now;
    tick(dt, now / 1000);
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
  (window as any).__ready = true;
}

// Persona quad: the same moment for four agent runs (cues + commentary each), one match clock.
async function quad() {
  const runs = (q.get('quad') ?? 'match.casual.en,match.analyst.en,match.player-a6.de,match.casual.tr').split(',');
  const scripts = await Promise.all(runs.map(async (r) => { const s = (await (await fetch(`data/${r}.cues.json`)).json()) as Script; s.cues.sort((a, b) => a.t - b.t); return s; }));
  const coms = await Promise.all(runs.map((r) => loadCommentary(`data/${r}.commentary.json`).catch(() => null)));
  const orig = await loadMatch(scripts[0].match ?? 'match');
  const from = +(q.get('from') ?? q.get('t') ?? 60), to = +(q.get('to') ?? from + 12);
  state.t = from;
  document.body.classList.add('quad', 'multi');
  const viewsEl = document.getElementById('views')!;
  // each quadrant gets a distinct look: casual (clean, warm), analyst (tactical cam, full lens, cool), player cam + card, other language
  const variants: Variant[] = runs.map((r) => { const [, p, l] = r.split('.'); return p === 'analyst' ? 'analyst' : p.startsWith('player') ? 'player' : l !== 'en' ? 'lang' : 'casual'; });
  const views = runs.map((r, i) => {
    const [, persona, lang] = r.split('.');
    const v = new View(orig, '', null, false, true);
    v.vs = { lens: scripts[i].lens ?? 0.2, cam: scripts[i].cam ?? 'broadcast', selected: null };
    v.gfx.tagScale = 1.5; // = overlay --k 0.75 / quadrant height 0.5
    const label = `${persona.startsWith('player') ? 'Player cam' : persona} · ${lang ?? ''}`;
    v.overlay = new Overlay(v.el, { label, panel: persona === 'analyst', match: orig, commentary: coms[i], audio: i === 0, variant: variants[i] });
    viewsEl.append(v.el);
    return v;
  });
  const hud = initHud(orig, null);
  const selectId = (vs: View['vs'], id: string | null | undefined) => {
    vs.selected = null;
    if (id) for (const side of ['home', 'away'] as Side[]) { const idx = orig.meta[side].players.findIndex((p) => p.id === id); if (idx >= 0) vs.selected = { side, idx }; }
  };
  const lastSel: (string | null | undefined)[] = runs.map(() => undefined);
  // live card for the player quadrant: speed from tracking, distance since kickoff, heart rate modelled from workload
  const cum = new Map<string, Float32Array>();
  const playerCard = (sel: View['vs']['selected'], s: ReturnType<typeof snapshot>): PlayerCard | null => {
    if (!sel) return null;
    const key = `${sel.side}${sel.idx}`, F = orig.frames;
    if (!cum.has(key)) { const c = new Float32Array(F.length); for (let i = 1; i < F.length; i++) { const a = F[i - 1][sel.side][sel.idx], b = F[i][sel.side][sel.idx]; const d = Math.hypot(b[0] - a[0], b[1] - a[1]); c[i] = c[i - 1] + (d < 5 ? d : 0); } cum.set(key, c); }
    const c = cum.get(key)!, fi = Math.min(F.length - 1, Math.max(0, Math.round((s.t - F[0].t) * orig.meta.fps))), w = Math.round(20 * orig.meta.fps);
    const kmh = Math.hypot(...s.vel[sel.side][sel.idx]) * 3.6, avg = (c[fi] - c[Math.max(0, fi - w)]) / 20; // m/s over 20 s
    const p = orig.meta[sel.side].players[sel.idx];
    return { num: p.num, name: p.name, color: orig.meta[sel.side].color, kmh, dist: c[fi], hr: Math.min(192, 92 + 62 * Math.min(1, avg / 4) + 28 * Math.min(1, kmh / 30)) };
  };
  if (q.get('ui') === '0' || capture) document.body.classList.add('noui');
  if (capture) document.body.classList.add('capture');
  views.forEach((v) => { v.resize(); v.rig.set(v.vs.cam, true); v.rig.snap(); });
  addEventListener('resize', () => views.forEach((v) => v.resize()));
  addEventListener('keydown', (e) => { if (e.key === ' ') { e.preventDefault(); state.playing = !state.playing; } });
  let lastT = state.t, frames = 0;
  const tick = (dt: number, now: number) => {
    if (state.playing) state.t += dt * state.speed;
    if (!capture && state.t > to) state.t = from;
    const jumped = Math.abs(state.t - lastT) > 1; lastT = state.t;
    let s0 = null;
    views.forEach((v, i) => {
      const d = evalCues(scripts[i], state.t), vt = variants[i];
      if (vt === 'analyst') { d.cam = 'tactical'; d.lens = 1; }
      if (vt === 'player') { d.cam = 'player'; d.select ??= scripts[i].select; }
      if (vt === 'casual' || vt === 'lang') d.lens = Math.min(d.lens, 0.15);
      if (i === 0) state.speed = d.speed; // one clock: the first quadrant's slow-mo drives all four
      if (d.cam !== v.vs.cam) { v.vs.cam = d.cam; v.rig.set(d.cam, d.cut || jumped); }
      if (d.select !== lastSel[i]) { lastSel[i] = d.select; if (d.select !== undefined) selectId(v.vs, d.select); }
      v.vs.lens = d.lens;
      if (jumped) v.rig.snap();
      const s = v.render(state.t, dt, now, false);
      v.overlay!.update(s, d.captions, v.gfx.last, i === 0 && state.playing && !capture, vt === 'player' ? playerCard(v.vs.selected, s) : null);
      s0 ??= s;
    });
    hud.update(s0!, 0, undefined, {});
    (window as any).__frames = ++frames;
  };
  let clockNow = 0;
  Object.assign(window, { demo: {
    state, window: [from, to], audio: coms[0]?.voice ?? [],
    seek(t: number) { state.t = lastT = t; state.playing = true; views.forEach((v) => v.rig.snap()); tick(0, clockNow); },
    step(dt: number) { clockNow += dt; tick(dt, clockNow); return state.t; },
  } });
  if (capture) { tick(0, 0); (window as any).__ready = true; return; }
  let last = performance.now();
  const loop = (now: number) => { const dt = Math.min(0.1, (now - last) / 1000); last = now; tick(dt, now / 1000); requestAnimationFrame(loop); };
  requestAnimationFrame(loop);
  (window as any).__ready = true;
}

main().catch((e) => {
  const el = document.getElementById('error')!;
  el.style.display = 'grid'; el.textContent = String(e?.message ?? e);
  console.error(e);
});
