// 3D-anchored broadcast graphics: rings, player tags, speed tag, back line, offside, shape, pass arrows, pressure.
// One flat line family (DESIGN.md): primary/secondary width, solid or dashed, white unless the colour carries a meaning,
// never brighter than 1.0 (no bloom). In = draw-on along the line, out = fade. Each element has a lens weight.
import * as THREE from 'three';
import { Match, Side, SIDES, Snapshot, V2, convexHull, dirOf, metrics, TeamMetrics, positionsAt } from './data';
import { toWorld } from './scene';
import { C, FONT, LINE, ease } from './tokens';

const smooth = (a: number, b: number, x: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const col = (hex: string) => new THREE.Color(hex);
export const SPRINT = 7.5; // m/s

// ---------- flat line on the grass: anti-aliased edge, optional dash, reveal = draw-on ----------
const ribbonMat = (color: THREE.Color) => new THREE.ShaderMaterial({
  transparent: true, depthWrite: false, toneMapped: false, side: THREE.DoubleSide,
  polygonOffset: true, polygonOffsetFactor: -4,
  uniforms: { color: { value: color }, opacity: { value: 1 }, reveal: { value: 1 }, len: { value: 1 }, dash: { value: 0 } },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.); }`,
  fragmentShader: `uniform vec3 color; uniform float opacity, reveal, len, dash; varying vec2 vUv;
    void main(){
      if (vUv.x > reveal) discard;
      if (dash > 0.0 && fract(vUv.x * len / dash) > 0.55) discard;
      float a = abs(vUv.y - 0.5) * 2.0, aa = fwidth(a) * 1.5;
      gl_FragColor = vec4(color, (1.0 - smoothstep(1.0 - aa, 1.0, a)) * opacity);
    }`,
});

export class Ribbon {
  mesh: THREE.Mesh; mat: THREE.ShaderMaterial; geo = new THREE.BufferGeometry();
  pos: Float32Array; uv: Float32Array;
  constructor(public width: number, color: THREE.Color, max = 64, dash = 0) {
    this.pos = new Float32Array(max * 2 * 3); this.uv = new Float32Array(max * 2 * 2);
    const idx: number[] = [];
    for (let i = 0; i < max - 1; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    this.geo.setIndex(idx);
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('uv', new THREE.BufferAttribute(this.uv, 2).setUsage(THREE.DynamicDrawUsage));
    this.mat = ribbonMat(color); this.mat.uniforms.dash.value = dash;
    this.mesh = new THREE.Mesh(this.geo, this.mat); this.mesh.frustumCulled = false; this.mesh.renderOrder = 2;
  }
  // reveal: 0..1 of the length drawn (draw-on)
  set(pts: THREE.Vector3[], opacity: number, reveal = 1) {
    this.mesh.visible = opacity > 0.01 && reveal > 0.001 && pts.length > 1;
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
    const U = this.mat.uniforms; U.opacity.value = opacity; U.len.value = total; U.reveal.value = reveal;
  }
}

// ---------- flat ring on the grass (same family: width in metres, optional dash, reveal = draw-on by angle) ----------
const ringMat = () => new THREE.ShaderMaterial({
  transparent: true, depthWrite: false, toneMapped: false, polygonOffset: true, polygonOffsetFactor: -4,
  uniforms: { color: { value: new THREE.Color(1, 1, 1) }, opacity: { value: 1 }, inner: { value: 0.9 }, dashN: { value: 0 }, reveal: { value: 1 } },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.); }`,
  fragmentShader: `uniform vec3 color; uniform float opacity, inner, dashN, reveal; varying vec2 vUv;
    void main(){
      vec2 d = vUv - 0.5; float r = length(d) * 2.0, aa = fwidth(r) * 1.5;
      float ang = atan(d.x, -d.y) / 6.2831853 + 0.5;
      if (ang > reveal || (dashN > 0.0 && fract(ang * dashN) > 0.55)) discard;
      gl_FragColor = vec4(color, smoothstep(inner - aa, inner, r) * (1.0 - smoothstep(1.0 - aa, 1.0, r)) * opacity);
    }`,
});
class Ring {
  mesh: THREE.Mesh; mat = ringMat();
  constructor(dashN = 0) {
    this.mat.uniforms.dashN.value = dashN;
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), this.mat);
    this.mesh.rotation.x = -Math.PI / 2; this.mesh.renderOrder = 1;
  }
  set(p: THREE.Vector3 | null, radius: number, width: number, color: THREE.Color, opacity: number, reveal = 1) {
    this.mesh.visible = !!p && opacity > 0.01 && reveal > 0.001;
    if (!this.mesh.visible) return;
    this.mesh.position.set(p!.x, 0.03, p!.z); this.mesh.scale.setScalar(radius * 2);
    const U = this.mat.uniforms; U.color.value.copy(color); U.opacity.value = opacity; U.inner.value = 1 - width / radius; U.reveal.value = reveal;
  }
  hide() { this.mesh.visible = false; }
}

// ---------- screen-sized canvas tag anchored in the world (player tag / line label) ----------
let tagIds = 0;
class Tag {
  canvas = document.createElement('canvas'); g: CanvasRenderingContext2D; tex: THREE.CanvasTexture; sprite: THREE.Sprite; key = '';
  id = tagIds++; contentW: number; screenH = 0; alpha = 0;
  constructor(public w = 720, public h = 100) {
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

// Canvas drawing of the tag/badge anatomy, shared with the design sheet. The plate fills the top PLATE of the canvas;
// a 2 px leader runs from the plate down to the anchor (the player's head).
export const PLATE = 0.7;
function plate(g: CanvasRenderingContext2D, x: number, w: number, ch: number) {
  const r = ch * 0.06;
  g.fillStyle = C.surface; g.beginPath(); g.roundRect(x, 0, w, ch, r); g.fill();
}
// player tag: [team bar][num][NAME] + optional [| value unit] metric (accent = live value) + optional focus underline (accent)
export function drawPlayerTag(g: CanvasRenderingContext2D, w: number, h: number, team: string, num: string, name: string,
  metric?: [string, string], focus = false, leader = true) {
  const ch = h * PLATE, fs = ch * 0.44, pad = ch * 0.3, bar = ch * 0.115;
  g.font = `700 ${fs}px ${FONT}`;
  const numW = g.measureText(num).width, nameW = name ? g.measureText(name).width + pad * 0.6 : 0;
  let mW = 0, vW = 0;
  if (metric) { vW = g.measureText(metric[0]).width; g.font = `500 ${fs * 0.8}px ${FONT}`; mW = pad * 2 + vW + fs * 0.2 + g.measureText(metric[1]).width; }
  const total = bar + pad + numW + nameW + pad + mW, x0 = (w - total) / 2, cy = ch / 2 + fs * 0.05;
  plate(g, x0, total, ch);
  g.fillStyle = team; g.fillRect(x0, 0, bar, ch);
  g.textBaseline = 'middle'; g.textAlign = 'left';
  let x = x0 + bar + pad;
  g.font = `700 ${fs}px ${FONT}`; g.fillStyle = name ? C.text2 : C.text; g.fillText(num, x, cy); x += numW + pad * 0.6;
  if (name) { g.fillStyle = C.text; g.fillText(name, x, cy); x += nameW - pad * 0.6; }
  x += pad;
  if (metric) {
    g.fillStyle = 'rgba(255,255,255,0.12)'; g.fillRect(x, ch * 0.22, 2, ch * 0.56); x += pad;
    g.fillStyle = C.accent; g.font = `700 ${fs}px ${FONT}`; g.fillText(metric[0], x, cy); x += vW + fs * 0.2;
    g.fillStyle = C.text2; g.font = `500 ${fs * 0.8}px ${FONT}`; g.fillText(metric[1], x, cy);
  }
  if (focus) { g.fillStyle = C.accent; g.fillRect(x0, ch - bar * 0.8, total, bar * 0.8); }
  if (leader) { g.fillStyle = 'rgba(255,255,255,0.7)'; g.fillRect(w / 2 - 1, ch, 2, h - ch); }
  return total;
}
// line label = label badge anatomy: [white bar][KICKER][value]
export function drawLabel(g: CanvasRenderingContext2D, w: number, h: number, kicker: string, value: string, sig: string = C.text) {
  const ch = h * PLATE, fs = ch * 0.4, pad = ch * 0.3, bar = ch * 0.115;
  g.font = `700 ${fs * 0.8}px ${FONT}`; const kW = g.measureText(kicker).width + 0.08 * fs * kicker.length;
  g.font = `700 ${fs}px ${FONT}`; const vW = g.measureText(value).width;
  const total = bar + pad + kW + pad * 0.7 + vW + pad, x0 = (w - total) / 2, cy = ch / 2 + fs * 0.05;
  plate(g, x0, total, ch);
  g.fillStyle = sig; g.fillRect(x0, 0, bar, ch);
  g.textBaseline = 'middle'; g.textAlign = 'left';
  g.font = `700 ${fs * 0.8}px ${FONT}`; g.fillStyle = C.text2;
  (g as any).letterSpacing = `${0.08 * fs}px`; g.fillText(kicker, x0 + bar + pad, cy); (g as any).letterSpacing = '0px';
  g.font = `700 ${fs}px ${FONT}`; g.fillStyle = C.text; g.fillText(value, x0 + bar + pad + kW + pad * 0.7, cy);
  return total;
}

function arrowHead() {
  const s = new THREE.Shape(); s.moveTo(0, 1); s.lineTo(-0.6, -0.4); s.lineTo(0.6, -0.4); s.closePath();
  const m = new THREE.Mesh(new THREE.ShapeGeometry(s), new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, toneMapped: false }));
  m.renderOrder = 3; return m;
}

// ---------- the graphics layer ----------
export interface GfxCtx { lens: number; selected: { side: Side; idx: number } | null; now: number; dt: number; cam: THREE.PerspectiveCamera }

const W = (x: number, y: number, z = 0.04) => toWorld(x, y, z);
const WHITE = col(C.text), ACCENT = col(C.accent), ALERT = col(C.alert);
const TAG_H = 0.034 / PLATE; // plate height = 3.4 % of the frame (= --u * 7 at 1080p)

export class Graphics {
  group = new THREE.Group();
  private ownerRing = new Ring(); private selRing = new Ring(); private pressRing = new Ring(24);
  private ownerTag = new Tag(); private selTag = new Tag(); private flareTag = new Tag();
  private lineTag = new Tag();
  private backLine = new Ribbon(LINE.primary, WHITE.clone()); private offside = new Ribbon(LINE.secondary, WHITE.clone(), 2, LINE.dash);
  private units: Record<Side, Ribbon[]> = { home: [], away: [] };
  private hullLine: Record<Side, Ribbon> = {} as any; private hullFill: Record<Side, THREE.Mesh> = {} as any;
  private arrows: { rib: Ribbon; head: THREE.Mesh }[] = [];
  private pressLines: Ribbon[] = [];
  private fades = new Map<string, number>();
  last?: Record<Side, TeamMetrics>;
  pressureCount = 0;

  constructor(private match: Match) {
    const add = (...o: THREE.Object3D[]) => this.group.add(...o);
    add(this.ownerRing.mesh, this.selRing.mesh, this.pressRing.mesh);
    add(this.ownerTag.sprite, this.selTag.sprite, this.flareTag.sprite, this.lineTag.sprite);
    add(this.backLine.mesh, this.offside.mesh);
    for (const side of SIDES) {
      for (let i = 0; i < 4; i++) { const r = new Ribbon(LINE.secondary, WHITE.clone(), 12); this.units[side].push(r); add(r.mesh); }
      this.hullLine[side] = new Ribbon(LINE.secondary, WHITE.clone(), 64, LINE.dash); add(this.hullLine[side].mesh);
      const fill = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial({ color: WHITE, transparent: true, depthWrite: false,
        opacity: 0.05, toneMapped: false, polygonOffset: true, polygonOffsetFactor: -2 }));
      fill.rotation.x = -Math.PI / 2; fill.position.y = 0.02; fill.renderOrder = 0; this.hullFill[side] = fill; add(fill);
    }
    for (let i = 0; i < 6; i++) { const a = { rib: new Ribbon(LINE.primary, WHITE.clone()), head: arrowHead() }; this.arrows.push(a); add(a.rib.mesh, a.head); }
    for (let i = 0; i < 4; i++) { const r = new Ribbon(LINE.secondary, ALERT.clone(), 2, LINE.dash * 0.6); this.pressLines.push(r); add(r.mesh); }
  }

  // eased per-key value so things fade in/out over time, not just with the lens
  private fade(key: string, target: number, dt: number, rate = 6) {
    const v = this.fades.get(key) ?? target, n = v + (target - v) * (1 - Math.exp(-dt * rate));
    this.fades.set(key, n); return n;
  }

  update(s: Snapshot, c: GfxCtx) {
    const { lens, dt, cam } = c, m = this.match;
    // lens weights (DESIGN.md density): casual = carrier + one speed tag; analysis = + back line, passes, pressure;
    // tactical = + offside, shape (speed tags drop out)
    const wPass = smooth(0.15, 0.45, lens), wPress = smooth(0.35, 0.6, lens), wLine = smooth(0.35, 0.65, lens);
    const wOff = smooth(0.6, 0.85, lens), wShape = smooth(0.65, 0.95, lens), wFlare = 1 - smooth(0.55, 0.75, lens);
    const live = s.mode === 'play' ? 1 : 0;
    const pp = (side: Side, i: number) => s.pos[side][i];
    const speed = (side: Side, i: number) => Math.hypot(...s.vel[side][i]);
    const playerTop = (side: Side, i: number) => W(pp(side, i)[0], pp(side, i)[1], 2.3);
    const kmh = (sp: number): [string, string] => [(sp * 3.6).toFixed(1), 'km/h'];

    // ball carrier: white ring + tag (every lens)
    const own = s.owner, fOwn = this.fade('own', own ? 1 : 0, dt, 8);
    if (own) {
      const [x, y] = pp(own.team, own.idx), tm = m.meta[own.team], p = tm.players[own.idx], sp = speed(own.team, own.idx), fast = sp > SPRINT && wFlare > 0.5;
      this.ownerRing.set(W(x, y), 1.0, LINE.secondary, WHITE, fOwn, ease(fOwn));
      this.ownerTag.draw(`${p.num}${p.name}${fast ? kmh(sp)[0] : ''}`, (g, w, h) => drawPlayerTag(g, w, h, tm.color, String(p.num), p.name.toUpperCase(), fast ? kmh(sp) : undefined));
      this.ownerTag.place(playerTop(own.team, own.idx), TAG_H, cam, fOwn);
    } else { this.ownerRing.hide(); this.ownerTag.place(null, 0, cam, 0); }

    // selected player = the focus: accent ring + tag with accent underline
    const sel = c.selected && !(own && own.team === c.selected.side && own.idx === c.selected.idx) ? c.selected : null;
    const selIsOwner = !!(c.selected && own && own.team === c.selected.side && own.idx === c.selected.idx);
    if (selIsOwner) this.ownerRing.set(W(...pp(own!.team, own!.idx)), 1.0, LINE.secondary, ACCENT, fOwn, ease(fOwn));
    if (sel) {
      const [x, y] = pp(sel.side, sel.idx), tm = m.meta[sel.side], p = tm.players[sel.idx];
      this.selRing.set(W(x, y), 1.0, LINE.secondary, ACCENT, 1);
      this.selTag.draw(`${p.num}${p.name}`, (g, w, h) => drawPlayerTag(g, w, h, tm.color, String(p.num), p.name.toUpperCase(), undefined, true));
      this.selTag.place(playerTop(sel.side, sel.idx), TAG_H, cam, 1);
    } else { this.selRing.hide(); this.selTag.place(null, 0, cam, 0); }

    // speed tag: the single fastest sprinter not already tagged (casual end of the lens only)
    const q = SIDES.flatMap((side) => s.pos[side].map((_, i) => ({ side, i, sp: speed(side, i) })))
      .filter((q) => q.sp > SPRINT && !(own && own.team === q.side && own.idx === q.i) && !(sel && sel.side === q.side && sel.idx === q.i))
      .sort((a, b) => b.sp - a.sp)[0];
    const fFlare = this.fade('flare', q && live ? 1 : 0, dt, 10) * wFlare;
    if (q) {
      const tm = m.meta[q.side], p = tm.players[q.i], v = kmh(q.sp);
      this.flareTag.draw(`${p.num}${v[0]}`, (g, w, h) => drawPlayerTag(g, w, h, tm.color, String(p.num), '', v));
      this.flareTag.place(playerTop(q.side, q.i), TAG_H * 0.9, cam, fFlare);
    } else this.flareTag.place(null, 0, cam, 0);

    // tactics
    const met = { home: metrics(m, s, 'home'), away: metrics(m, s, 'away') };
    this.last = met;
    const defending: Side = own ? (own.team === 'home' ? 'away' : 'home') : s.ball[0] > 0 ? 'away' : 'home';
    const fDef = (side: Side) => this.fade(`def-${side}`, defending === side ? 1 : 0, dt, 3);
    const fd = { home: fDef('home'), away: fDef('away') };

    // back line of the defending team: primary white, drawn on with the lens; label at the far end
    {
      const side = defending, P = s.pos[side], mt = met[side];
      const line = [...mt.shape.def].sort((a, b) => P[a][1] - P[b][1]).map((i) => W(P[i][0], P[i][1]));
      const w = wLine * fd[side] * live;
      this.backLine.set(line, Math.min(1, w * 3), ease(w));
      const far = line[0] && line[line.length - 1];
      const hgt = mt.lineHeight.toFixed(1);
      this.lineTag.draw(`${hgt}`, (g, cw, ch) => drawLabel(g, cw, ch, 'LINE HEIGHT', `${hgt} m`));
      this.lineTag.place(far ? far.clone().add(new THREE.Vector3(0, 0.3, -2)) : null, TAG_H * 0.85, cam, smooth(0.6, 1, w));
      // offside line across the pitch at the second-last defender: secondary dashed
      const wo = wOff * fd[side] * live;
      this.offside.set([W(mt.offsideX, -34, 0.05), W(mt.offsideX, 34, 0.05)], Math.min(1, wo * 3) * 0.85, ease(wo));
    }

    // team shape of the defending side: dashed hull + solid unit lines, faint fill
    for (const side of SIDES) {
      const P = s.pos[side], mt = met[side], f = wShape * live * fd[side];
      const hull = convexHull(P.filter((_, i) => i !== mt.shape.gk));
      this.hullLine[side].set([...hull, hull[0]].map((p) => W(p[0], p[1], 0.035)), Math.min(1, f * 3) * 0.6, ease(f));
      const fill = this.hullFill[side];
      fill.visible = f > 0.01;
      if (fill.visible) {
        fill.geometry.dispose(); fill.geometry = new THREE.ShapeGeometry(new THREE.Shape(hull.map((p) => new THREE.Vector2(p[0], p[1]))));
        (fill.material as THREE.MeshBasicMaterial).opacity = 0.05 * f;
      }
      this.units[side].forEach((r, k) => {
        const ln = mt.shape.lines[k];
        r.set(ln && ln.length > 1 ? [...ln].sort((a, b) => P[a][1] - P[b][1]).map((i) => W(P[i][0], P[i][1], 0.045)) : [], Math.min(1, f * 3) * 0.8, ease(f));
      });
    }

    // passes (white) and shots (white, wider) draw themselves along the grass; a misplaced pass is a risk (alert)
    const active = m.events.filter((e) => (e.type === 'pass' || e.type === 'shot') && s.t >= e.t && s.t < e.t + (e.dur ?? 1) + 1.4).slice(-this.arrows.length);
    this.arrows.forEach((a, k) => {
      const e = active[k];
      if (!e) { a.rib.set([], 0); a.head.visible = false; return; }
      const isShot = e.type === 'shot', side = e.team ?? 'home';
      const from: V2 = e.from ?? (positionsAt(m, e.t).pos[side][e.idx ?? 0]);
      const to: V2 = e.to ?? (isShot ? [52.5 * dirOf(side), 0] : positionsAt(m, e.t + (e.dur ?? 1)).ball.slice(0, 2) as V2);
      const prog = ease(Math.min(1, (s.t - e.t) / (e.dur ?? 1))), fade = 1 - Math.min(1, Math.max(0, (s.t - e.t - (e.dur ?? 1)) / 1.4));
      const weight = isShot ? 1 : wPass;
      const color = e.ok === false ? ALERT : WHITE;
      const pts: THREE.Vector3[] = [];
      for (let i = 0; i <= 24; i++) { const u = i / 24; pts.push(W(from[0] + (to[0] - from[0]) * u, from[1] + (to[1] - from[1]) * u, 0.05)); }
      a.rib.width = isShot ? LINE.primary * 1.5 : LINE.primary;
      a.rib.mat.uniforms.color.value.copy(color);
      a.rib.set(pts, weight * fade, prog);
      const tip = W(from[0] + (to[0] - from[0]) * prog, from[1] + (to[1] - from[1]) * prog, 0.055);
      a.head.visible = weight * fade > 0.01 && prog > 0.05;
      a.head.position.copy(tip);
      a.head.rotation.set(-Math.PI / 2, 0, Math.atan2(to[1] - from[1], to[0] - from[0]) - Math.PI / 2);
      a.head.scale.setScalar(isShot ? 1.3 : 1);
      const hm = a.head.material as THREE.MeshBasicMaterial; hm.color.copy(color); hm.opacity = weight * fade;
    });

    // pressure on the ball carrier (risk): dashed 5 m ring + dashed line to each presser inside it
    let n = 0;
    if (own) {
      const [x, y] = pp(own.team, own.idx), opp: Side = own.team === 'home' ? 'away' : 'home';
      const near = s.pos[opp].map((p, i) => ({ i, d: Math.hypot(p[0] - x, p[1] - y) })).filter((q) => q.d < 5).sort((a, b) => a.d - b.d);
      n = near.length;
      const fp = wPress * this.fade('press', n ? 1 : 0, dt, 6);
      this.pressRing.set(W(x, y), 5, LINE.secondary, ALERT, fp * 0.9, ease(fp));
      this.pressLines.forEach((r, k) => {
        const q = near[k];
        r.set(q ? [W(x, y, 0.06), W(s.pos[opp][q.i][0], s.pos[opp][q.i][1], 0.06)] : [], wPress * 0.9);
      });
    } else { this.pressRing.hide(); this.pressLines.forEach((r) => r.set([], 0)); }
    this.pressureCount = n;
    this.declutter(cam, dt);
  }

  // screen-space collision: walk tags by priority, hide (fade) any that overlap an already-kept one
  private declutter(cam: THREE.PerspectiveCamera, dt: number) {
    cam.updateMatrixWorld();
    const order = [this.selTag, this.ownerTag, this.flareTag, this.lineTag];
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
