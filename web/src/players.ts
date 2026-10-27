// Rigged players (CC0 Quaternius Universal Animation Library mannequin) with speed-blended locomotion, kick overlay,
// team kits painted per body region, shirt numbers, skin/hair variety; textured ball with spin and trail.
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { Match, Side, SIDES, Snapshot, positionsAt } from './data';
import { toWorld, filmic } from './scene';

// ---------- one-time asset prep ----------
const gltf = await new GLTFLoader().loadAsync('assets/players/mannequin.glb');
const template = gltf.scene;
template.updateMatrixWorld(true);

// body regions from the dominant skinning bone + bind-pose height, so one mesh can wear any kit
const R = { skin: 0, shirt: 1, shorts: 2, socks: 3, boots: 4, hair: 5, hands: 6 };
const skinned: THREE.SkinnedMesh[] = [];
template.traverse((o) => { if ((o as THREE.SkinnedMesh).isSkinnedMesh) skinned.push(o as THREE.SkinnedMesh); });
const backZ = { min: 0, max: 0 };
for (const m of skinned) {
  const g = m.geometry, pos = g.attributes.position, ji = g.attributes.skinIndex, jw = g.attributes.skinWeight;
  const names = m.skeleton.bones.map((b) => b.name), reg = new Float32Array(pos.count);
  for (let i = 0; i < pos.count; i++) {
    let best = 0, bw = -1;
    for (let k = 0; k < 4; k++) { const w = jw.getComponent(i, k); if (w > bw) { bw = w; best = ji.getComponent(i, k); } }
    const n = names[best] ?? '', x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i), ax = Math.abs(x);
    let r = R.skin;
    if (/spine|shoulder|hips/.test(n)) r = /hips/.test(n) && y < 1.0 ? R.shorts : R.shirt;
    else if (/upper_arm/.test(n)) r = ax < 0.36 ? R.shirt : R.skin;
    else if (/thigh/.test(n)) r = y > 0.66 ? R.shorts : R.skin;
    else if (/shin/.test(n)) r = y < 0.44 ? R.socks : R.skin;
    else if (/foot|toe/.test(n)) r = y < 0.1 || /toe/.test(n) ? R.boots : R.socks;
    else if (/hand|f_|thumb/.test(n)) r = R.hands;
    else if (/head/.test(n)) r = y > 1.72 && (z < 0.02 || y > 1.78) ? R.hair : R.skin;
    reg[i] = r;
    if (r === R.shirt && y > 1.25 && y < 1.42 && ax < 0.08) { backZ.min = Math.min(backZ.min, z); backZ.max = Math.max(backZ.max, z); }
  }
  g.setAttribute('region', new THREE.BufferAttribute(reg, 1));
}

// clips: in-place (strip root x/z drift), and measure each loop's native ground speed from foot travel
const clip = (n: string) => {
  const c = gltf.animations.find((a) => a.name === n)!.clone();
  for (const t of c.tracks) if (t.name === 'root.position') for (let i = 0; i < t.values.length; i += 3) { t.values[i] = t.values[0]; t.values[i + 2] = t.values[2]; }
  return c;
};
const CLIPS = { idle: clip('Idle_Loop'), walk: clip('Walk_Loop'), jog: clip('Jog_Fwd_Loop'), sprint: clip('Sprint_Loop') };
function nativeSpeed(c: THREE.AnimationClip) {
  const probe = cloneSkinned(template), mixer = new THREE.AnimationMixer(probe), foot = probe.getObjectByName('DEF-footL')!;
  mixer.clipAction(c).play();
  let mn = Infinity, mx = -Infinity; const v = new THREE.Vector3();
  for (let i = 0; i <= 40; i++) { mixer.setTime((c.duration * i) / 40); probe.updateMatrixWorld(true); foot.getWorldPosition(v); mn = Math.min(mn, v.z); mx = Math.max(mx, v.z); }
  return (2 * (mx - mn)) / c.duration; // stance foot sweeps ~half the cycle at ground speed
}
const LOCO = (['walk', 'jog', 'sprint'] as const).map((k) => ({ k, v: nativeSpeed(CLIPS[k]), dur: CLIPS[k].duration }));

const SKIN = ['#f3cfb3', '#e0ac8a', '#c68a62', '#a0673f', '#6e4428', '#4a2d1b'].map((c) => new THREE.Color(c));
const HAIR = ['#1b1410', '#2e1f14', '#5a3b22', '#8a6a3c', '#c8a46a', '#0e0e0e'].map((c) => new THREE.Color(c));
const BOOTS = ['#111111', '#f2f2f2', '#d8ff3a', '#ff5a1f', '#1e6bff'].map((c) => new THREE.Color(c));

function kitMaterial(cols: THREE.Color[], ghost: boolean) {
  if (ghost) return new THREE.MeshBasicMaterial({ color: cols[R.shirt].clone().lerp(new THREE.Color('#fff'), 0.35).multiplyScalar(1.3), transparent: true, opacity: 0.5, depthWrite: false });
  const m = new THREE.MeshStandardMaterial({ roughness: 0.62, metalness: 0 });
  return filmic(m, 'kit', (s) => {
    s.uniforms.uRegion = { value: cols };
    s.vertexShader = s.vertexShader.replace('#include <common>', '#include <common>\nattribute float region;\nvarying float vRegion;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvRegion = region;');
    s.fragmentShader = s.fragmentShader.replace('#include <common>', '#include <common>\nuniform vec3 uRegion[7];\nvarying float vRegion;')
      .replace('#include <color_fragment>', '#include <color_fragment>\n{ int r = int(vRegion + 0.5); vec3 c = uRegion[0];\n'
        + ' for (int k = 1; k < 7; k++) if (k == r) c = uRegion[k];\n diffuseColor.rgb *= c; }');
  });
}

function numberTexture(num: number, fg: string) {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d')!;
  g.font = '700 100px "Barlow Condensed", sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillStyle = fg; g.fillText(String(num), 64, 70);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t;
}

export interface Figure {
  root: THREE.Group; mixer: THREE.AnimationMixer; acts: Record<keyof typeof CLIPS, THREE.AnimationAction>; mats: THREE.Material[];
  thighR: THREE.Bone; shinR: THREE.Bone; spine: THREE.Bone; phase: number; yaw: number; last: THREE.Vector3; idleOff: number; kicks: number[];
}

function figure(cols: THREE.Color[], num: number, ghost: boolean, numberColor: string, seed: number): Figure {
  const model = cloneSkinned(template), mats: THREE.Material[] = [];
  const mat = kitMaterial(cols, ghost); mats.push(mat);
  model.traverse((o) => {
    const m = o as THREE.SkinnedMesh;
    if (m.isSkinnedMesh) { m.material = mat; m.castShadow = !ghost; m.frustumCulled = false; }
  });
  model.scale.setScalar(1.0);
  const root = new THREE.Group(); root.add(model);
  model.updateMatrixWorld(true);
  const bone = (n: string) => model.getObjectByName(n) as THREE.Bone;
  if (!ghost) { // number on the back (big) and chest (small), riding the upper spine
    const nm = filmic(new THREE.MeshStandardMaterial({ map: numberTexture(num, numberColor), transparent: true, roughness: 0.6, polygonOffset: true, polygonOffsetFactor: -2 }), 'num');
    const back = new THREE.Mesh(new THREE.PlaneGeometry(0.26, 0.26), nm); back.position.set(0, 1.3, backZ.min - 0.012); back.rotation.y = Math.PI;
    const front = new THREE.Mesh(new THREE.PlaneGeometry(0.1, 0.1), nm); front.position.set(0.07, 1.36, backZ.max + 0.012);
    model.add(back, front); bone('DEF-spine003').attach(back); bone('DEF-spine003').attach(front);
  }
  const mixer = new THREE.AnimationMixer(model);
  const acts = Object.fromEntries(Object.entries(CLIPS).map(([k, c]) => { const a = mixer.clipAction(c); a.play(); a.setEffectiveWeight(0); return [k, a]; })) as Figure['acts'];
  model.traverse((o) => { o.userData.figureRoot = root; });
  return { root, mixer, acts, mats, thighR: bone('DEF-thighR'), shinR: bone('DEF-shinR'), spine: bone('DEF-spine001'),
    phase: (seed * 0.37) % 1, yaw: 0, last: new THREE.Vector3(), idleOff: seed * 0.71, kicks: [] };
}

const bell = (x: number, w: number) => Math.exp(-(x * x) / (2 * w * w));
const _q = new THREE.Quaternion(), _ax = new THREE.Vector3(1, 0, 0);

export class Players {
  group = new THREE.Group();
  figs: Record<Side, Figure[]> = { home: [], away: [] };
  ball: THREE.Mesh;
  trail: THREE.Sprite[] = [];
  // ghost-only: ground rings + displacement lines from the reference (original) positions
  rings: THREE.Mesh[] = []; links?: THREE.LineSegments;

  constructor(public match: Match, ghost = false) {
    for (const side of SIDES) {
      const tm = match.meta[side];
      tm.players.forEach((p, i) => {
        const gk = p.pos === 'GK', seed = i * 7 + (side === 'home' ? 0 : 3);
        const shirt = gk ? new THREE.Color(side === 'home' ? '#b9d63c' : '#e8892c') : new THREE.Color(tm.color);
        const shorts = gk ? new THREE.Color('#1a1a1a') : side === 'home' ? new THREE.Color('#f2f2f2') : new THREE.Color(tm.color).multiplyScalar(0.3);
        const socks = gk ? new THREE.Color('#1a1a1a') : side === 'home' ? new THREE.Color(tm.color) : new THREE.Color('#f2f2f2');
        const skin = SKIN[(seed * 5) % SKIN.length];
        const cols = [skin, shirt, shorts, socks, BOOTS[(seed * 3) % BOOTS.length], HAIR[(seed * 11) % HAIR.length], gk ? new THREE.Color('#e9e9e9') : skin];
        const f = figure(cols, p.num, ghost, gk ? '#111' : side === 'home' ? '#ffffff' : '#ffffff', seed);
        f.root.userData.pick = { side, idx: i };
        f.kicks = match.events.filter((e) => (e.type === 'pass' || e.type === 'shot') && e.team === side && e.idx === i).map((e) => e.t);
        this.figs[side].push(f); this.group.add(f.root);
        if (ghost) {
          const ring = new THREE.Mesh(new THREE.RingGeometry(0.75, 1.0, 32), new THREE.MeshBasicMaterial({
            color: new THREE.Color(tm.color).lerp(new THREE.Color('#fff'), 0.4).multiplyScalar(1.8), transparent: true, opacity: 0.8,
            depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }));
          ring.rotation.x = -Math.PI / 2; this.rings.push(ring); this.group.add(ring);
        }
      });
    }
    // regulation size 5 ball (r = 0.11 m)
    this.ball = new THREE.Mesh(new THREE.SphereGeometry(0.11, 24, 16), ghost
      ? new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.5 })
      : filmic(new THREE.MeshStandardMaterial({ map: ballTexture(), roughness: 0.35 }), 'ball'));
    this.ball.castShadow = !ghost; this.group.add(this.ball);
    if (ghost) {
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(22 * 6), 3));
      g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(22 * 6), 3));
      this.links = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending,
        depthWrite: false, toneMapped: false }));
      this.links.frustumCulled = false; this.group.add(this.links);
    }
    if (!ghost) {
      const tex = glowTexture();
      for (let i = 0; i < 26; i++) {
        const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, color: new THREE.Color(2.2, 2.4, 2.6), transparent: true,
          blending: THREE.AdditiveBlending, depthWrite: false }));
        this.trail.push(s); this.group.add(s);
      }
    }
  }

  private lastBall = new THREE.Vector3();

  update(s: Snapshot, dt: number, ref?: Snapshot) {
    const v = new THREE.Vector3();
    // ghost: only players whose what-if position differs (>~1.5 m) show up, fading in with the difference
    if (this.links && ref) {
      const a = this.links.geometry.attributes.position as THREE.BufferAttribute, c = this.links.geometry.attributes.color as THREE.BufferAttribute;
      let k = 0;
      const vis = (d: number) => Math.min(1, Math.max(0, (d - 1.0) / 1.5));
      for (const side of SIDES) s.pos[side].forEach(([x, y], i) => {
        const [rx, ry] = ref.pos[side][i], d = Math.hypot(x - rx, y - ry), al = vis(d), f = this.figs[side][i];
        const ln = al * Math.min(1, Math.max(0, (22 - d) / 6)); // no links once the timelines have fully diverged
        a.setXYZ(k, x, 0.08, -y); c.setXYZ(k++, 1.3 * ln, 1.6 * ln, 0.6 * ln);
        a.setXYZ(k, rx, 0.08, -ry); c.setXYZ(k++, 0.3 * ln, 0.35 * ln, 0.15 * ln);
        const ring = this.rings[(side === 'home' ? 0 : 11) + i];
        ring.position.set(x, 0.05, -y); ring.visible = f.root.visible = al > 0.02;
        (ring.material as THREE.MeshBasicMaterial).opacity = 0.8 * al;
        for (const m of f.mats) m.opacity = 0.55 * al;
      });
      a.needsUpdate = c.needsUpdate = true;
      (this.ball.material as THREE.MeshBasicMaterial).opacity = 0.6 * vis(Math.hypot(s.ball[0] - ref.ball[0], s.ball[1] - ref.ball[1]));
    }
    for (const side of SIDES)
      this.figs[side].forEach((f, i) => {
        if (!f.root.visible) return;
        const [x, y] = s.pos[side][i], [vx, vy] = s.vel[side][i], sp = Math.hypot(vx, vy);
        toWorld(x, y, 0, v);
        f.root.position.copy(v);
        // face velocity when moving, else the ball
        const tx = sp > 0.6 ? vx : s.ball[0] - x, ty = sp > 0.6 ? vy : s.ball[1] - y;
        const want = Math.atan2(tx, -ty); // world: +x -> yaw π/2 ; data +y is world -z
        let d = want - f.yaw; d = Math.atan2(Math.sin(d), Math.cos(d));
        f.yaw += d * (1 - Math.exp(-dt * 8));
        f.root.rotation.y = f.yaw;
        // locomotion blend: weights between idle / walk / jog / sprint by ground speed; one shared phase keeps feet in sync
        const w = { idle: 0, walk: 0, jog: 0, sprint: 0 };
        const anchors = [0, ...LOCO.map((l) => l.v)], keys = ['idle', 'walk', 'jog', 'sprint'] as const;
        if (sp >= anchors[3]) w.sprint = 1;
        else for (let k = 0; k < 3; k++) if (sp < anchors[k + 1]) { const u = (sp - anchors[k]) / (anchors[k + 1] - anchors[k]); w[keys[k]] = 1 - u; w[keys[k + 1]] = u; break; }
        const moving = 1 - w.idle;
        const cycle = moving > 0 ? LOCO.reduce((a, l) => a + (w[l.k] / moving) * l.v * l.dur, 0) : 1; // metres per cycle
        const travelled = Math.min(f.last.distanceTo(v), 2); f.last.copy(v);
        f.phase = (f.phase + travelled / cycle) % 1;
        for (const l of LOCO) { const a = f.acts[l.k]; a.setEffectiveWeight(w[l.k]); a.time = f.phase * l.dur; }
        f.acts.idle.setEffectiveWeight(w.idle); f.acts.idle.time = (s.t + f.idleOff) % CLIPS.idle.duration;
        f.mixer.update(0);
        // kick overlay on the right leg around pass/shot events: back-swing, strike, follow-through
        const kt = f.kicks.find((t) => Math.abs(s.t - t) < 0.45);
        if (kt != null) {
          const tau = s.t - kt;
          const thigh = -0.55 * bell(tau + 0.14, 0.07) + 1.05 * bell(tau - 0.03, 0.08);
          const shin = 1.2 * bell(tau + 0.1, 0.08) - 0.2 * bell(tau - 0.04, 0.06);
          f.thighR.quaternion.multiply(_q.setFromAxisAngle(_ax, -thigh));
          f.shinR.quaternion.multiply(_q.setFromAxisAngle(_ax, shin));
          f.spine.quaternion.multiply(_q.setFromAxisAngle(_ax, 0.12 * bell(tau, 0.12)));
        }
      });
    toWorld(s.ball[0], s.ball[1], Math.max(s.ball[2], 0.11), this.ball.position);
    // spin: roll about the axis perpendicular to travel
    const mv = this.ball.position.clone().sub(this.lastBall); this.lastBall.copy(this.ball.position);
    const dist = Math.hypot(mv.x, mv.z);
    if (dist > 1e-4 && dist < 3) this.ball.rotateOnWorldAxis(new THREE.Vector3(mv.z, 0, -mv.x).normalize(), dist / 0.11);
    // trail: past ball positions straight from data, so it is scrub-safe
    this.trail.forEach((sp, k) => {
      const tt = s.t - (k + 1) * 0.025;
      const p = positionsAt(this.match, tt).ball;
      toWorld(p[0], p[1], Math.max(p[2], 0.11), sp.position);
      const fade = 1 - k / this.trail.length, moving = sp.position.distanceTo(this.ball.position) > 0.3 ? 1 : 0;
      sp.scale.setScalar(0.3 * fade + 0.05);
      (sp.material as THREE.SpriteMaterial).opacity = 0.4 * fade * fade * moving;
    });
  }
}

// match ball: white with dark curved panel seams and two accent swooshes (equirect)
let _ball: THREE.Texture | null = null;
function ballTexture() {
  if (_ball) return _ball;
  const c = document.createElement('canvas'); c.width = 512; c.height = 256;
  const g = c.getContext('2d')!;
  g.fillStyle = '#f4f4f2'; g.fillRect(0, 0, 512, 256);
  g.strokeStyle = 'rgba(40,40,48,0.55)'; g.lineWidth = 3;
  for (let k = 0; k < 6; k++) { g.beginPath(); for (let x = 0; x <= 512; x += 8) { const y = 128 + Math.sin((x / 512) * Math.PI * 2 * 2 + k) * 70 * Math.cos(k); x ? g.lineTo(x, y) : g.moveTo(x, y); } g.stroke(); }
  g.lineWidth = 16;
  for (const [col, off] of [['#1d3fd1', 0], ['#e0262c', Math.PI]] as const) {
    g.strokeStyle = col; g.beginPath();
    for (let x = 0; x <= 512; x += 8) { const y = 128 + Math.sin((x / 512) * Math.PI * 4 + off) * 50; x ? g.lineTo(x, y) : g.moveTo(x, y); } g.stroke();
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return (_ball = t);
}

let _glow: THREE.Texture | null = null;
export function glowTexture() {
  if (_glow) return _glow;
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d')!, r = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  r.addColorStop(0, 'rgba(255,255,255,1)'); r.addColorStop(0.35, 'rgba(255,255,255,0.45)'); r.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = r; g.fillRect(0, 0, 64, 64);
  return (_glow = new THREE.CanvasTexture(c));
}
