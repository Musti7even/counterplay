// Stylised low-poly players (team colours, shirt numbers, run cycle) + ball with glowing trail.
import * as THREE from 'three';
import { Match, Side, SIDES, Snapshot, positionsAt } from './data';
import { toWorld } from './scene';

const SKIN = [0xf1c7a5, 0xd9a07a, 0xa86b45, 0x6e4228, 0x4a2c1a];
const darker = (hex: string, k: number) => new THREE.Color(hex).multiplyScalar(k);

function numberTexture(num: number, fg = '#ffffff') {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d')!;
  g.font = '800 104px "Barlow Condensed", sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillStyle = fg; g.fillText(String(num), 64, 70);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

export interface Figure { mats: THREE.Material[]; root: THREE.Group; legs: THREE.Object3D[]; arms: THREE.Object3D[]; phase: number; yaw: number; last: THREE.Vector3 }

const geo = {
  torso: new THREE.CapsuleGeometry(0.2, 0.42, 4, 10),
  shorts: new THREE.CylinderGeometry(0.21, 0.19, 0.26, 10),
  leg: new THREE.CapsuleGeometry(0.085, 0.72, 3, 8),
  arm: new THREE.CapsuleGeometry(0.065, 0.5, 3, 8),
  head: new THREE.SphereGeometry(0.13, 14, 10),
  num: new THREE.PlaneGeometry(0.3, 0.3),
};

function figure(shirt: THREE.Color, shorts: THREE.Color, skin: number, num: number, ghost: boolean): Figure {
  const mk = (color: THREE.Color | number) => ghost
    ? new THREE.MeshBasicMaterial({ color: new THREE.Color(color).lerp(new THREE.Color('#ffffff'), 0.35).multiplyScalar(1.3), transparent: true, opacity: 0.5, depthWrite: false })
    : new THREE.MeshStandardMaterial({ color, roughness: 0.62 });
  const shirtM = mk(shirt), shortsM = mk(shorts), skinM = mk(skin), sockM = mk(shirt.clone().multiplyScalar(0.8));
  const root = new THREE.Group(), body = new THREE.Group();
  root.add(body); body.scale.setScalar(1.12);
  const torso = new THREE.Mesh(geo.torso, shirtM); torso.position.y = 1.3; torso.scale.set(1, 1, 0.72); body.add(torso);
  const sh = new THREE.Mesh(geo.shorts, shortsM); sh.position.y = 0.93; body.add(sh);
  const head = new THREE.Mesh(geo.head, skinM); head.position.y = 1.78; body.add(head);
  const legs: THREE.Object3D[] = [], arms: THREE.Object3D[] = [];
  for (const s of [-1, 1]) {
    const hip = new THREE.Group(); hip.position.set(0.1 * s, 0.92, 0);
    const leg = new THREE.Mesh(geo.leg, sockM); leg.position.y = -0.45; hip.add(leg); body.add(hip); legs.push(hip);
    const sho = new THREE.Group(); sho.position.set(0.27 * s, 1.5, 0); sho.rotation.z = 0.12 * s;
    const arm = new THREE.Mesh(geo.arm, s > 0 ? shirtM : shirtM); arm.position.y = -0.3; sho.add(arm); body.add(sho); arms.push(sho);
  }
  if (!ghost) {
    const nm = new THREE.MeshBasicMaterial({ map: numberTexture(num), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
    const back = new THREE.Mesh(geo.num, nm); back.position.set(0, 1.33, -0.152); back.rotation.y = Math.PI; body.add(back);
    const front = new THREE.Mesh(geo.num, nm); front.position.set(0.07, 1.42, 0.152); front.scale.setScalar(0.45); body.add(front);
    body.traverse((o) => { if ((o as THREE.Mesh).isMesh && o !== back && o !== front) o.castShadow = true; });
  }
  body.traverse((o) => { o.userData.figureRoot = root; });
  return { mats: [shirtM, shortsM, skinM, sockM], root, legs, arms, phase: Math.random() * 6, yaw: 0, last: new THREE.Vector3() };
}

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
        const gk = p.pos === 'GK';
        const shirt = gk ? new THREE.Color(side === 'home' ? '#c8e64a' : '#f29f3d') : new THREE.Color(tm.color);
        const shorts = gk ? darker('#222', 1) : side === 'home' ? new THREE.Color('#f4f4f4') : darker(tm.color, 0.35);
        const f = figure(shirt, shorts, SKIN[(i * 7 + (side === 'home' ? 0 : 3)) % SKIN.length], p.num, ghost);
        f.root.userData.pick = { side, idx: i };
        this.figs[side].push(f); this.group.add(f.root);
        if (ghost) {
          const ring = new THREE.Mesh(new THREE.RingGeometry(0.75, 1.0, 32), new THREE.MeshBasicMaterial({
            color: new THREE.Color(tm.color).lerp(new THREE.Color('#fff'), 0.4).multiplyScalar(1.8), transparent: true, opacity: 0.8,
            depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }));
          ring.rotation.x = -Math.PI / 2; this.rings.push(ring); this.group.add(ring);
        }
      });
    }
    this.ball = new THREE.Mesh(new THREE.IcosahedronGeometry(0.17, 2), ghost
      ? new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.5 })
      : new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0x666666, roughness: 0.35 }));
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
        const [x, y] = s.pos[side][i], [vx, vy] = s.vel[side][i], sp = Math.hypot(vx, vy);
        toWorld(x, y, 0, v);
        f.root.position.copy(v);
        // face velocity when moving, else the ball
        const tx = sp > 0.6 ? vx : s.ball[0] - x, ty = sp > 0.6 ? vy : s.ball[1] - y;
        const want = Math.atan2(tx, -ty); // world: +x -> yaw π/2 ; data +y is world -z
        let d = want - f.yaw; d = Math.atan2(Math.sin(d), Math.cos(d));
        f.yaw += d * (1 - Math.exp(-dt * 10));
        f.root.rotation.y = f.yaw;
        const travelled = Math.min(f.last.distanceTo(v), 2); f.last.copy(v);
        f.phase += travelled * 2.1;
        const amp = Math.min(sp / 7, 1) * 0.75;
        f.legs[0].rotation.x = Math.sin(f.phase) * amp; f.legs[1].rotation.x = -Math.sin(f.phase) * amp;
        f.arms[0].rotation.x = -Math.sin(f.phase) * amp * 0.8; f.arms[1].rotation.x = Math.sin(f.phase) * amp * 0.8;
        f.root.children[0].rotation.x = Math.min(sp / 9, 1) * 0.18; // lean into the run
      });
    toWorld(s.ball[0], s.ball[1], Math.max(s.ball[2], 0.17), this.ball.position);
    this.ball.rotation.x += dt * 4;
    // trail: past ball positions straight from data, so it is scrub-safe
    this.trail.forEach((sp, k) => {
      const tt = s.t - (k + 1) * 0.025;
      const p = positionsAt(this.match, tt).ball;
      toWorld(p[0], p[1], Math.max(p[2], 0.17), sp.position);
      const fade = 1 - k / this.trail.length, moving = sp.position.distanceTo(this.ball.position) > 0.3 ? 1 : 0;
      sp.scale.setScalar(0.42 * fade + 0.08);
      (sp.material as THREE.SpriteMaterial).opacity = 0.55 * fade * fade * moving;
    });
  }
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
