import '@fontsource/barlow-condensed/600.css';
import '@fontsource/barlow-condensed/700.css';
import '@fontsource/barlow-condensed/800.css';
import '@fontsource/barlow-condensed/800-italic.css';
import './style.css';
import * as THREE from 'three';
import { Match, Side, loadMatch, mergeFork, snapshot, duration, startTime, clock } from './data';
import { buildStadium, makeComposer } from './scene';
import { Players } from './players';
import { Graphics } from './graphics';
import { CameraRig, CamMode } from './cameras';
import { initHud } from './hud';

const q = new URLSearchParams(location.search);
type ViewMode = 'single' | 'split' | 'ghost';

class View {
  el = document.createElement('div');
  renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance', preserveDrawingBuffer: true });
  scene = new THREE.Scene();
  cam = new THREE.PerspectiveCamera(24, 16 / 9, 0.5, 600);
  rig = new CameraRig(this.cam);
  post = makeComposer(this.renderer, this.scene, this.cam);
  players: Players; gfx: Graphics; ghosts: Players | null = null;
  label: HTMLElement;

  constructor(public match: Match, labelText: string, ghostOf: Match | null, whatIf = false) {
    this.el.className = 'view';
    this.el.append(this.renderer.domElement);
    this.label = document.createElement('div');
    this.label.className = `view-label${whatIf ? ' whatif' : ''}`;
    this.label.innerHTML = `<span class="vl-name">${labelText}</span><span class="vl-score"></span>`;
    this.el.append(this.label);
    this.renderer.shadowMap.enabled = true; this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.toneMapping = THREE.NoToneMapping;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    buildStadium(this.renderer, this.scene, [match.meta.home.name, match.meta.away.name]);
    this.players = new Players(match); this.gfx = new Graphics(match);
    this.scene.add(this.players.group, this.gfx.group);
    if (ghostOf) { this.ghosts = new Players(ghostOf, true); this.scene.add(this.ghosts.group); }
    this.renderer.domElement.addEventListener('click', (ev) => this.pick(ev));
  }

  resize() {
    const w = this.el.clientWidth, h = this.el.clientHeight, dpr = Math.min(devicePixelRatio, 2);
    this.renderer.setPixelRatio(dpr); this.renderer.setSize(w, h, false);
    this.post.composer.setPixelRatio(dpr); this.post.composer.setSize(w, h);
    this.cam.aspect = w / h; this.cam.updateProjectionMatrix();
  }

  pick(ev: MouseEvent) {
    const r = this.renderer.domElement.getBoundingClientRect(), ray = new THREE.Raycaster();
    ray.setFromCamera(new THREE.Vector2(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1), this.cam);
    const hit = ray.intersectObject(this.players.group, true).find((h) => h.object.userData.figureRoot);
    state.selected = hit ? hit.object.userData.figureRoot.userData.pick : null;
  }

  render(t: number, dt: number, now: number, showGhost: boolean) {
    const s = snapshot(this.match, t);
    this.players.update(s, dt);
    if (this.ghosts) {
      const fs = snapshot(this.ghosts.match, t), on = showGhost && t >= forkT;
      this.ghosts.group.visible = on;
      if (on) this.ghosts.update(fs, dt, s);
    }
    this.rig.update(s, state.cam === 'player' ? state.selected : null, dt);
    this.gfx.update(s, { lens: state.lens, selected: state.selected, now, dt, cam: this.cam });
    this.post.grade.uniforms.desat.value = state.lens * 0.22;
    this.post.grade.uniforms.vignette.value = 0.3 + state.lens * 0.1;
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

async function main() {
  await Promise.all(['600', '700', '800'].map((w) => document.fonts.load(`${w} 40px "Barlow Condensed"`)));
  const name = q.get('match') ?? 'match';
  const orig = await loadMatch(name).catch(() => (q.get('match') ? Promise.reject(new Error(`could not load /data/${name}.json`)) : loadMatch('mock')));
  const forkRaw = q.get('fork') ? await loadMatch(q.get('fork')!) : null;
  const fork = forkRaw ? mergeFork(orig, forkRaw) : null;
  forkT = fork?.meta.forkOf?.t ?? forkRaw?.frames[0].t ?? Infinity;
  state.view = fork ? ((q.get('view') as ViewMode) ?? 'split') : 'single';
  // what-if story window: a few seconds of lead-in, ~10 s after the fork (GRF diverges into noise later)
  const win = fork && q.get('loop') !== '0' ? [Math.max(startTime(orig), forkT - 5), forkT + 10] : null;
  state.t = q.has('t') ? +q.get('t')! : win ? win[0] : startTime(orig);
  const fp = (fork?.meta.forkOf as any)?.params?.player as string | undefined;
  if (fp) for (const side of ['home', 'away'] as Side[]) {
    const idx = orig.meta[side].players.findIndex((p) => p.id === fp);
    if (idx >= 0) state.selected = { side, idx };
  }

  const viewsEl = document.getElementById('views')!;
  const main = new View(orig, 'ORIGINAL', fork, false);
  const alt = fork ? new View(fork, 'WHAT IF', null, true) : null;
  viewsEl.append(main.el);
  if (alt) viewsEl.append(alt.el);
  const hud = initHud(orig, fork);
  const end = Math.max(duration(orig), fork ? duration(fork) : 0);

  const applyView = () => {
    if (alt) alt.el.style.display = state.view === 'split' ? '' : 'none';
    document.body.classList.toggle('split', state.view === 'split');
    document.querySelectorAll<HTMLButtonElement>('#viewmode button').forEach((b) => b.classList.toggle('on', b.dataset.view === state.view));
    (main.label.querySelector('.vl-name') as HTMLElement).textContent = state.view === 'ghost' ? 'ORIGINAL + WHAT IF GHOSTS' : 'ORIGINAL';
    document.body.classList.toggle('multi', state.view !== 'single');
    requestAnimationFrame(() => [main, alt].forEach((v) => v?.resize()));
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
  if (q.get('ui') === '0') document.body.classList.add('noui');
  if (q.has('sel')) { const [side, idx] = q.get('sel')!.split(':'); state.selected = { side: side as Side, idx: +idx }; }
  addEventListener('resize', () => [main, alt].forEach((v) => v?.resize()));

  setCam(state.cam, true); setPlaying(state.playing); applyView();
  [main, alt].forEach((v) => { v?.resize(); v?.rig.snap(); });

  let last = performance.now(), lastT = state.t, frames = 0;
  const loop = (now: number) => {
    const dt = Math.min(0.1, (now - last) / 1000); last = now;
    if (state.playing) state.t += dt * state.speed;
    if (win && state.playing && state.t > win[1]) state.t = win[0];
    if (state.t >= end) { state.t = end; setPlaying(false); }
    state.t = Math.max(startTime(orig), state.t);
    if (Math.abs(state.t - lastT) > 1) [main, alt].forEach((v) => v?.rig.snap());
    lastT = state.t;
    state.lens += (state.lensTarget - state.lens) * (1 - Math.exp(-dt * 5));
    const s = main.render(state.t, dt, now / 1000, state.view === 'ghost');
    if (alt && state.view === 'split') alt.render(state.t, dt, now / 1000, false);
    hud.update(s, state.lens, main.gfx.last, main.gfx.pressureCount);
    (window as any).__frames = ++frames;
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
  Object.assign(window, { demo: { state, setCam, clock } });
}

main().catch((e) => {
  const el = document.getElementById('error')!;
  el.style.display = 'grid'; el.textContent = String(e?.message ?? e);
  console.error(e);
});
