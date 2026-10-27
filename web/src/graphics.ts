// 3D-anchored broadcast graphics: rings, tags, speed flares, back line, offside, shape, pass arrows, pressure.
// Every element has a lens weight (0 casual .. 1 tactical) so the picture morphs instead of toggling.
import * as THREE from 'three';
import { Match, Side, SIDES, Snapshot, V2, convexHull, dirOf, metrics, TeamMetrics, positionsAt } from './data';
import { toWorld } from './scene';

const smooth = (a: number, b: number, x: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const hdr = (hex: string, k: number) => new THREE.Color(hex).multiplyScalar(k);
const FONT = '"Barlow Condensed", "Barlow", sans-serif';
export const SPRINT = 7.5; // m/s

// ---------- glowing ribbon on the grass ----------
const ribbonMat = (color: THREE.Color) => new THREE.ShaderMaterial({
  transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false, side: THREE.DoubleSide,
  polygonOffset: true, polygonOffsetFactor: -4,
  uniforms: { color: { value: color }, opacity: { value: 1 }, reveal: { value: 1 }, len: { value: 1 }, dash: { value: 0 } },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.); }`,
  fragmentShader: `uniform vec3 color; uniform float opacity, reveal, len, dash; varying vec2 vUv;
    void main(){
      if (vUv.x > reveal) discard;
      float m = vUv.x * len;
      if (dash > 0.5 && fract(m / 2.2) > 0.55) discard;
      float a = abs(vUv.y - 0.5) * 2.0;
      float core = 1.0 - smoothstep(0.0, 0.42, a), halo = pow(1.0 - a, 2.2) * 0.55;
      float head = (1.0 - smoothstep(0.0, 4.0, (reveal - vUv.x) * len)) * step(reveal, 0.999);
      vec3 c = color * (core * 0.9 + halo * 0.8 + head * 1.2);
      gl_FragColor = vec4(c * opacity, (core + halo) * opacity);
    }`,
});

export class Ribbon {
  mesh: THREE.Mesh; mat: THREE.ShaderMaterial; geo = new THREE.BufferGeometry();
  pos: Float32Array; uv: Float32Array;
  constructor(public width: number, color: THREE.Color, max = 64) {
    this.pos = new Float32Array(max * 2 * 3); this.uv = new Float32Array(max * 2 * 2);
    const idx: number[] = [];
    for (let i = 0; i < max - 1; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    this.geo.setIndex(idx);
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('uv', new THREE.BufferAttribute(this.uv, 2).setUsage(THREE.DynamicDrawUsage));
    this.mat = ribbonMat(color);
    this.mesh = new THREE.Mesh(this.geo, this.mat); this.mesh.frustumCulled = false; this.mesh.renderOrder = 2;
  }
  set(pts: THREE.Vector3[], opacity: number) {
    this.mesh.visible = opacity > 0.01 && pts.length > 1;
    if (!this.mesh.visible) return;
    let total = 0; const acc = [0];
    for (let i = 1; i < pts.length; i++) acc.push((total += pts[i].distanceTo(pts[i - 1])));
    for (let i = 0; i < pts.length; i++) {
      const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
      let tx = b.x - a.x, tz = b.z - a.z; const l = Math.hypot(tx, tz) || 1; tx /= l; tz /= l;
      const nx = -tz * this.width / 2, nz = tx * this.width / 2, p = pts[i];
      this.pos.set([p.x + nx, p.y, p.z + nz, p.x - nx, p.y, p.z - nz], i * 6);
      const u = total ? acc[i] / total : 0;
      this.uv.set([u, 0, u, 1], i * 4);
    }
    this.geo.setDrawRange(0, (pts.length - 1) * 6);
    this.geo.attributes.position.needsUpdate = this.geo.attributes.uv.needsUpdate = true;
    this.mat.uniforms.opacity.value = opacity; this.mat.uniforms.len.value = total;
  }
}

// ---------- flat discs: rings, pulses, pressure heat ----------
const discMat = (kind: number) => new THREE.ShaderMaterial({
  transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false,
  polygonOffset: true, polygonOffsetFactor: -4,
  uniforms: { color: { value: new THREE.Color(1, 1, 1) }, opacity: { value: 1 }, time: { value: 0 } },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.); }`,
  fragmentShader: `uniform vec3 color; uniform float opacity, time; varying vec2 vUv;
    void main(){
      float r = length(vUv - 0.5) * 2.0; float a;
      ${kind === 0
        ? `a = 1.0 - smoothstep(0.0, 0.06, abs(r - 0.82)) + 0.35 * (1.0 - smoothstep(0.0, 0.25, abs(r - 0.82))) + 0.10 * (1.0 - smoothstep(0.0, 0.8, r));
           float ang = atan(vUv.y - 0.5, vUv.x - 0.5); a *= 0.75 + 0.25 * sin(ang * 3.0 + time * 3.0);`
        : kind === 1
        ? `a = (1.0 - smoothstep(0.0, 0.08, abs(r - 0.8))) * (1.0 - smoothstep(0.7, 1.0, r));`
        : `a = pow(1.0 - smoothstep(0.0, 1.0, r), 1.6) * (0.75 + 0.25 * sin(time * 6.0 - r * 9.0));`}
      gl_FragColor = vec4(color * a * opacity, a * opacity);
    }`,
});
class Disc {
  mesh: THREE.Mesh; mat: THREE.ShaderMaterial;
  constructor(kind: number) {
    this.mat = discMat(kind);
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), this.mat);
    this.mesh.rotation.x = -Math.PI / 2; this.mesh.renderOrder = 1;
  }
  set(p: THREE.Vector3 | null, radius: number, color: THREE.Color, opacity: number, time: number) {
    this.mesh.visible = !!p && opacity > 0.01;
    if (!p) return;
    this.mesh.position.set(p.x, 0.03, p.z); this.mesh.scale.setScalar(radius * 2);
    this.mat.uniforms.color.value.copy(color); this.mat.uniforms.opacity.value = opacity; this.mat.uniforms.time.value = time;
  }
}

// ---------- screen-sized text tag anchored in the world ----------
let tagIds = 0;
class Tag {
  canvas = document.createElement('canvas'); g: CanvasRenderingContext2D; tex: THREE.CanvasTexture; sprite: THREE.Sprite; key = '';
  id = tagIds++; contentW: number; screenH = 0; alpha = 0;
  constructor(public w = 640, public h = 96) {
    this.canvas.width = w; this.canvas.height = h; this.g = this.canvas.getContext('2d')!; this.contentW = w;
    this.tex = new THREE.CanvasTexture(this.canvas); this.tex.colorSpace = THREE.SRGBColorSpace;
    this.tex.minFilter = THREE.LinearFilter; this.tex.generateMipmaps = false;
    this.sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.tex, transparent: true, depthTest: false, depthWrite: false, sizeAttenuation: false }));
    this.sprite.center.set(0.5, 0); this.sprite.renderOrder = 10;
  }
  draw(key: string, fn: (g: CanvasRenderingContext2D, w: number, h: number) => number | void) {
    if (key === this.key) return;
    this.key = key; this.g.clearRect(0, 0, this.w, this.h);
    this.contentW = Math.min(this.w, fn(this.g, this.w, this.h) ?? this.w); this.tex.needsUpdate = true;
  }
  place(p: THREE.Vector3 | null, screenH: number, cam: THREE.PerspectiveCamera, opacity: number) {
    this.sprite.visible = !!p && opacity > 0.01;
    if (!p) return;
    this.sprite.position.copy(p);
    const s = screenH * 2 * Math.tan(THREE.MathUtils.degToRad(cam.fov) / 2);
    this.sprite.scale.set((s * this.w) / this.h, s, 1);
    this.sprite.material.opacity = this.alpha = opacity; this.screenH = screenH;
  }
}

// chip: [num on team colour][NAME][optional accent segment], centred in the canvas
function chip(g: CanvasRenderingContext2D, w: number, h: number, color: string, num: string, name: string, accent?: string) {
  const pad = 16, fs = h * 0.56;
  g.font = `700 ${fs}px ${FONT}`; const nameW = name ? g.measureText(name).width + pad * 2 : 0;
  g.font = `800 ${fs}px ${FONT}`; const numW = Math.max(h * 0.9, g.measureText(num).width + pad * 1.6);
  g.font = `800 ${fs * 0.9}px ${FONT}`; const accW = accent ? g.measureText(accent).width + pad * 2 : 0;
  const total = numW + nameW + accW, x0 = (w - total) / 2, y0 = h * 0.08, ch = h * 0.78;
  g.textBaseline = 'middle';
  g.fillStyle = color; g.fillRect(x0, y0, numW, ch);
  g.fillStyle = 'rgba(8,12,24,0.88)'; g.fillRect(x0 + numW, y0, nameW + accW, ch);
  g.fillStyle = '#fff'; g.font = `800 ${fs}px ${FONT}`; g.textAlign = 'center'; g.fillText(num, x0 + numW / 2, y0 + ch / 2 + 2);
  if (name) { g.font = `700 ${fs}px ${FONT}`; g.textAlign = 'left'; g.fillText(name, x0 + numW + pad, y0 + ch / 2 + 2); }
  if (accent) {
    g.fillStyle = '#d4ff3a'; g.fillRect(x0 + numW + nameW, y0, accW, ch);
    g.fillStyle = '#0a0f1c'; g.font = `800 ${fs * 0.9}px ${FONT}`; g.textAlign = 'center';
    g.fillText(accent, x0 + numW + nameW + accW / 2, y0 + ch / 2 + 2);
  }
  g.fillStyle = 'rgba(255,255,255,0.9)'; g.fillRect(x0, y0 + ch, total, 3); // underline
  return total;
}
function metricChip(g: CanvasRenderingContext2D, w: number, h: number, color: string, parts: [string, string][]) {
  const fs = h * 0.5, pad = 14;
  const widths = parts.map(([k, v]) => { g.font = `600 ${fs * 0.8}px ${FONT}`; const a = g.measureText(k).width; g.font = `800 ${fs}px ${FONT}`; return a + g.measureText(v).width + pad * 3; });
  const total = widths.reduce((a, b) => a + b, 0) + 8, y0 = h * 0.1, ch = h * 0.76;
  let x = (w - total) / 2;
  g.fillStyle = 'rgba(8,12,24,0.85)'; g.fillRect(x, y0, total, ch);
  g.fillStyle = color; g.fillRect(x, y0, 8, ch); x += 8;
  g.textBaseline = 'middle'; g.textAlign = 'left';
  parts.forEach(([k, v], i) => {
    g.font = `600 ${fs * 0.8}px ${FONT}`; g.fillStyle = 'rgba(200,215,235,0.85)'; g.fillText(k, x + pad, y0 + ch / 2 + 2);
    const kw = g.measureText(k).width;
    g.font = `800 ${fs}px ${FONT}`; g.fillStyle = '#fff'; g.fillText(v, x + pad * 2 + kw, y0 + ch / 2 + 2);
    x += widths[i];
  });
  return total;
}

// ---------- flat text on the grass ----------
class Decal {
  canvas = document.createElement('canvas'); tex: THREE.CanvasTexture; mesh: THREE.Mesh; key = '';
  constructor(wm: number, hm: number) {
    this.canvas.width = 512; this.canvas.height = Math.round((512 * hm) / wm);
    this.tex = new THREE.CanvasTexture(this.canvas); this.tex.anisotropy = 8;
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(wm, hm),
      new THREE.MeshBasicMaterial({ map: this.tex, transparent: true, depthWrite: false, toneMapped: false, polygonOffset: true, polygonOffsetFactor: -4 }));
    this.mesh.rotation.x = -Math.PI / 2; this.mesh.renderOrder = 1;
  }
  text(s: string, color: string) {
    if (s + color === this.key) return; this.key = s + color;
    const g = this.canvas.getContext('2d')!, { width: w, height: h } = this.canvas;
    g.clearRect(0, 0, w, h); g.font = `800 ${h * 0.9}px ${FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillStyle = color; g.fillText(s, w / 2, h * 0.55); this.tex.needsUpdate = true;
  }
}

function arrowHead() {
  const s = new THREE.Shape(); s.moveTo(0, 1.1); s.lineTo(-0.75, -0.5); s.lineTo(0, -0.15); s.lineTo(0.75, -0.5); s.closePath();
  const m = new THREE.Mesh(new THREE.ShapeGeometry(s), new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, toneMapped: false, blending: THREE.AdditiveBlending }));
  m.renderOrder = 3; return m;
}

// ---------- the graphics layer ----------
export interface GfxCtx { lens: number; selected: { side: Side; idx: number } | null; now: number; dt: number; cam: THREE.PerspectiveCamera }

const W = (x: number, y: number, z = 0.04) => toWorld(x, y, z);

export class Graphics {
  group = new THREE.Group();
  private ownerRing = new Disc(0); private selRing = new Disc(0); private pressure = new Disc(2);
  private pulses = [new Disc(1), new Disc(1), new Disc(1)];
  private ownerTag = new Tag(); private selTag = new Tag(); private flareTags = [new Tag(), new Tag()];
  private numTags: Record<Side, Tag[]> = { home: [], away: [] };
  private lineTag = new Tag(720, 80);
  private backLine: Ribbon; private offside: Ribbon;
  private units: Record<Side, Ribbon[]> = { home: [], away: [] };
  private hullLine: Record<Side, Ribbon> = {} as any; private hullFill: Record<Side, THREE.Mesh> = {} as any;
  private formation: Record<Side, Decal> = {} as any;
  private arrows: { rib: Ribbon; head: THREE.Mesh }[] = [];
  private pressLines: Ribbon[] = [];
  private fades = new Map<string, number>();
  last?: Record<Side, TeamMetrics>;
  pressureCount = 0;

  constructor(private match: Match) {
    const add = (...o: THREE.Object3D[]) => this.group.add(...o);
    add(this.ownerRing.mesh, this.selRing.mesh, this.pressure.mesh, ...this.pulses.map((p) => p.mesh));
    add(this.ownerTag.sprite, this.selTag.sprite, ...this.flareTags.map((t) => t.sprite), this.lineTag.sprite);
    this.backLine = new Ribbon(0.6, hdr('#7fe8ff', 1.5)); this.offside = new Ribbon(0.3, hdr('#ffd23a', 1.3));
    add(this.backLine.mesh, this.offside.mesh);
    for (const side of SIDES) {
      const col = match.meta[side].color, light = new THREE.Color(col).lerp(new THREE.Color('#fff'), 0.35);
      for (let i = 0; i < 4; i++) { const r = new Ribbon(0.3, light.clone().multiplyScalar(0.9), 12); this.units[side].push(r); add(r.mesh); }
      this.hullLine[side] = new Ribbon(0.25, light.clone().multiplyScalar(1.2)); add(this.hullLine[side].mesh);
      const fill = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial({ color: col, transparent: true, depthWrite: false,
        opacity: 0.12, toneMapped: false, polygonOffset: true, polygonOffsetFactor: -2 }));
      fill.rotation.x = -Math.PI / 2; fill.position.y = 0.02; fill.renderOrder = 0; this.hullFill[side] = fill; add(fill);
      this.formation[side] = new Decal(10, 3.2); add(this.formation[side].mesh);
      match.meta[side].players.forEach((p) => {
        const t = new Tag(160, 80); t.draw('n', (g, w, h) => chip(g, w, h, col, String(p.num), ''));
        this.numTags[side].push(t); add(t.sprite);
      });
    }
    for (let i = 0; i < 6; i++) { const a = { rib: new Ribbon(0.7, new THREE.Color(1, 1, 1)), head: arrowHead() }; this.arrows.push(a); add(a.rib.mesh, a.head); }
    for (let i = 0; i < 4; i++) { const r = new Ribbon(0.35, hdr('#ff3b30', 2.0), 2); r.mat.uniforms.dash.value = 1; this.pressLines.push(r); add(r.mesh); }
  }

  // eased per-key value so things fade in/out over time, not just with the lens
  private fade(key: string, target: number, dt: number, rate = 6) {
    const v = this.fades.get(key) ?? target, n = v + (target - v) * (1 - Math.exp(-dt * rate));
    this.fades.set(key, n); return n;
  }

  update(s: Snapshot, c: GfxCtx) {
    const { lens, now, dt, cam } = c, m = this.match;
    const wPass = smooth(0.12, 0.5, lens), wPress = smooth(0.3, 0.65, lens), wLine = smooth(0.4, 0.75, lens);
    const wOff = smooth(0.5, 0.85, lens), wShape = smooth(0.6, 0.95, lens), wNums = smooth(0.72, 1, lens);
    const live = s.mode === 'play' ? 1 : 0;
    const pp = (side: Side, i: number) => s.pos[side][i];
    const speed = (side: Side, i: number) => Math.hypot(...s.vel[side][i]);
    const playerTop = (side: Side, i: number) => W(pp(side, i)[0], pp(side, i)[1], 2.45);
    const tagH = 0.036;

    // owner ring + tag (casual and tactical)
    const own = s.owner, fOwn = this.fade('own', own ? 1 : 0, dt, 8);
    if (own) {
      const [x, y] = pp(own.team, own.idx), tm = m.meta[own.team], p = tm.players[own.idx], sp = speed(own.team, own.idx);
      this.ownerRing.set(W(x, y), 1.25, hdr('#ffffff', 1.6), fOwn, now);
      const fast = sp > SPRINT;
      const pulse = fast ? 1 + 0.06 * Math.sin(now * 14) : 1;
      this.ownerTag.draw(`${p.num}${p.name}${fast ? (sp * 3.6).toFixed(1) : ''}`, (g, w, h) =>
        chip(g, w, h, tm.color, String(p.num), p.name.toUpperCase(), fast ? `${(sp * 3.6).toFixed(1)} KM/H` : undefined));
      this.ownerTag.place(playerTop(own.team, own.idx), tagH * pulse, cam, fOwn);
    } else { this.ownerRing.set(null, 0, new THREE.Color(), 0, now); this.ownerTag.place(null, 0, cam, 0); }

    // selected player
    const sel = c.selected && !(own && own.team === c.selected.side && own.idx === c.selected.idx) ? c.selected : null;
    if (sel) {
      const [x, y] = pp(sel.side, sel.idx), tm = m.meta[sel.side], p = tm.players[sel.idx], sp = speed(sel.side, sel.idx);
      this.selRing.set(W(x, y), 1.1, hdr('#3ae0ff', 1.8), 1, now);
      this.selTag.draw(`${p.num}${p.name}${sp > SPRINT ? (sp * 3.6).toFixed(1) : ''}`, (g, w, h) =>
        chip(g, w, h, tm.color, String(p.num), p.name.toUpperCase(), sp > SPRINT ? `${(sp * 3.6).toFixed(1)} KM/H` : undefined));
      this.selTag.place(playerTop(sel.side, sel.idx), tagH, cam, 1);
    } else { this.selRing.set(null, 0, new THREE.Color(), 0, now); this.selTag.place(null, 0, cam, 0); }

    // speed flares: two fastest sprinters that aren't already tagged
    const sprinters = SIDES.flatMap((side) => s.pos[side].map((_, i) => ({ side, i, sp: speed(side, i) })))
      .filter((q) => q.sp > SPRINT && !(own && own.team === q.side && own.idx === q.i) && !(sel && sel.side === q.side && sel.idx === q.i))
      .sort((a, b) => b.sp - a.sp).slice(0, 2);
    this.flareTags.forEach((t, k) => {
      const q = sprinters[k], f = this.fade(`flare${k}`, q && live ? 1 : 0, dt, 10);
      if (!q) { t.place(null, 0, cam, 0); this.pulses[k].set(null, 0, new THREE.Color(), 0, now); return; }
      const tm = m.meta[q.side], p = tm.players[q.i], kmh = (q.sp * 3.6).toFixed(1);
      t.draw(`${p.num}${kmh}`, (g, w, h) => chip(g, w, h, tm.color, String(p.num), '', `${kmh} KM/H`));
      t.place(playerTop(q.side, q.i), tagH * 0.85 * (1 + 0.07 * Math.sin(now * 14)), cam, f);
      const ph = (now * 1.6 + k * 0.5) % 1;
      this.pulses[k].set(W(...pp(q.side, q.i)), 0.8 + ph * 2.2, hdr('#d4ff3a', 1.8), f * (1 - ph), now);
    });
    const ph2 = (now * 1.6) % 1;
    if (own && speed(own.team, own.idx) > SPRINT) this.pulses[2].set(W(...pp(own.team, own.idx)), 0.8 + ph2 * 2.2, hdr('#d4ff3a', 1.8), 1 - ph2, now);
    else this.pulses[2].set(null, 0, new THREE.Color(), 0, now);

    // number chips over everyone (tactical end of the lens)
    for (const side of SIDES) this.numTags[side].forEach((t, i) => {
      const tagged = (own && own.team === side && own.idx === i) || (sel && sel.side === side && sel.idx === i) || sprinters.some((q) => q.side === side && q.i === i);
      t.place(playerTop(side, i), tagH * 0.6, cam, tagged ? 0 : wNums * 0.9);
    });

    // tactics
    const met = { home: metrics(m, s, 'home'), away: metrics(m, s, 'away') };
    this.last = met;
    const defending: Side = own ? (own.team === 'home' ? 'away' : 'home') : s.ball[0] > 0 ? 'away' : 'home';
    const fd = { home: this.fade('def-home', defending === 'home' ? 1 : 0, dt, 3), away: this.fade('def-away', defending === 'away' ? 1 : 0, dt, 3) };
    const fDef = (side: Side) => fd[side];

    // back line of the defending team (cross-fades when possession flips)
    {
      const side = defending, P = s.pos[side], d = dirOf(side), mt = met[side];
      const line = [...mt.shape.def].sort((a, b) => P[a][1] - P[b][1]).map((i) => W(P[i][0], P[i][1]));
      const f = fDef(side);
      this.backLine.set(line, wLine * f * live);
      const far = line[0] && line[line.length - 1];
      const anchor = far ? far.clone().add(new THREE.Vector3(0, 0.3, -4)) : null;
      const hgt = mt.lineHeight.toFixed(1), len = mt.length.toFixed(0), wid = mt.width.toFixed(0);
      this.lineTag.draw(`${side}${hgt}${len}${wid}`, (g, w, h) => metricChip(g, w, h, '#7fe8ff',
        [['LINE HEIGHT', `${hgt} M`], ['COMPACT', `${len} × ${wid} M`]]));
      this.lineTag.place(anchor, tagH * 0.9, cam, wLine * f * live);
      void d;
      // offside line across the pitch at the second-last defender
      const ox = mt.offsideX;
      this.offside.set([W(ox, -34, 0.05), W(ox, 34, 0.05)], wOff * f * live * 0.9);
    }

    // team shape: hull + unit lines + formation decal
    for (const side of SIDES) {
      const P = s.pos[side], mt = met[side], col = m.meta[side].color, f = wShape * live * fDef(side);
      const out = P.filter((_, i) => i !== mt.shape.gk);
      const hull = convexHull(out);
      this.hullLine[side].set([...hull, hull[0]].map((p) => W(p[0], p[1], 0.035)), f * 0.55);
      const fill = this.hullFill[side];
      fill.visible = f > 0.01;
      if (fill.visible) {
        fill.geometry.dispose(); fill.geometry = new THREE.ShapeGeometry(new THREE.Shape(hull.map((p) => new THREE.Vector2(p[0], p[1]))));
        (fill.material as THREE.MeshBasicMaterial).opacity = 0.05 * f;
      }
      this.units[side].forEach((r, k) => {
        const ln = mt.shape.lines[k];
        r.set(ln && ln.length > 1 ? [...ln].sort((a, b) => P[a][1] - P[b][1]).map((i) => W(P[i][0], P[i][1], 0.045)) : [], f * 0.9);
      });
      const back = mt.shape.def.map((i) => P[i]), bx = back.reduce((a, p) => a + p[0], 0) / back.length;
      const dec = this.formation[side];
      dec.text(mt.label, col);
      dec.mesh.visible = f > 0.01;
      dec.mesh.position.copy(W(bx - dirOf(side) * 7, 0, 0.03));
      (dec.mesh.material as THREE.MeshBasicMaterial).opacity = f * 0.7;
    }

    // pass + shot arrows drawing themselves along the grass
    const active = m.events.filter((e) => (e.type === 'pass' || e.type === 'shot') && s.t >= e.t && s.t < e.t + (e.dur ?? 1) + 1.4).slice(-this.arrows.length);
    this.arrows.forEach((a, k) => {
      const e = active[k];
      if (!e) { a.rib.set([], 0); a.head.visible = false; return; }
      const isShot = e.type === 'shot', side = e.team ?? 'home';
      const from: V2 = e.from ?? (positionsAt(m, e.t).pos[side][e.idx ?? 0]);
      const to: V2 = e.to ?? (isShot ? [52.5 * dirOf(side), 0] : positionsAt(m, e.t + (e.dur ?? 1)).ball.slice(0, 2) as V2);
      const prog = Math.min(1, (s.t - e.t) / (e.dur ?? 1)), fade = 1 - Math.min(1, Math.max(0, (s.t - e.t - (e.dur ?? 1)) / 1.4));
      const weight = isShot ? 1 : wPass;
      const color = isShot ? hdr('#ffd23a', 2.4) : e.ok === false ? hdr('#ff4d4d', 2) : new THREE.Color(m.meta[side].color).lerp(new THREE.Color('#fff'), 0.55).multiplyScalar(2);
      const pts: THREE.Vector3[] = [];
      for (let i = 0; i <= 24; i++) { const u = i / 24; pts.push(W(from[0] + (to[0] - from[0]) * u, from[1] + (to[1] - from[1]) * u, 0.05)); }
      a.rib.mat.uniforms.color.value.copy(color);
      a.rib.mat.uniforms.reveal.value = prog;
      a.rib.set(pts, weight * fade);
      const tip = W(from[0] + (to[0] - from[0]) * prog, from[1] + (to[1] - from[1]) * prog, 0.055);
      a.head.visible = weight * fade > 0.01 && prog > 0.05;
      a.head.position.copy(tip);
      a.head.rotation.set(-Math.PI / 2, 0, Math.atan2(to[1] - from[1], to[0] - from[0]) - Math.PI / 2);
      a.head.scale.setScalar(1.1);
      const hm = a.head.material as THREE.MeshBasicMaterial; hm.color.copy(color); hm.opacity = weight * fade;
    });

    // pressure on the ball carrier: heat disc + dashed lines to each presser within 5 m
    let n = 0;
    if (own) {
      const [x, y] = pp(own.team, own.idx), opp: Side = own.team === 'home' ? 'away' : 'home';
      const near = s.pos[opp].map((p, i) => ({ i, d: Math.hypot(p[0] - x, p[1] - y) })).filter((q) => q.d < 5).sort((a, b) => a.d - b.d);
      n = near.length;
      const heat = n >= 3 ? hdr('#ff2d2d', 1.6) : n === 2 ? hdr('#ff7a1a', 1.4) : hdr('#ffc53a', 1.2);
      this.pressure.set(n ? W(x, y) : null, 5, heat, wPress * this.fade('press', Math.min(n, 3) / 3 * 0.6 + (n ? 0.4 : 0), dt, 5), now);
      this.pressLines.forEach((r, k) => {
        const q = near[k];
        r.set(q ? [W(x, y, 0.06), W(s.pos[opp][q.i][0], s.pos[opp][q.i][1], 0.06)] : [], wPress * 0.9);
      });
    } else { this.pressure.set(null, 0, new THREE.Color(), 0, now); this.pressLines.forEach((r) => r.set([], 0)); }
    this.pressureCount = n;
    this.declutter(cam, dt);
  }

  // screen-space collision: walk tags by priority, hide (fade) any that overlap an already-kept one
  private declutter(cam: THREE.PerspectiveCamera, dt: number) {
    cam.updateMatrixWorld();
    const order = [this.ownerTag, this.selTag, ...this.flareTags, this.lineTag, ...this.numTags.home, ...this.numTags.away];
    const kept: number[][] = [], v = new THREE.Vector3(), pad = 0.006;
    for (const t of order) {
      let ok = t.sprite.visible && t.alpha > 0.01;
      if (ok) {
        v.copy(t.sprite.position).project(cam);
        const hh = t.screenH * 2, ww = (hh * t.contentW) / t.h / cam.aspect; // NDC units
        const r = [v.x - ww / 2 - pad, v.x + ww / 2 + pad, v.y - pad, v.y + hh + pad];
        ok = !kept.some((k) => r[0] < k[1] && r[1] > k[0] && r[2] < k[3] && r[3] > k[2]);
        if (ok) kept.push(r);
      }
      const f = this.fade(`tag${t.id}`, ok ? 1 : 0, dt, 12);
      t.sprite.material.opacity = t.alpha * f;
    }
  }
}
