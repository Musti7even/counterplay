// Night stadium for a "real footage" look: PBR grass with mowing sheen + wear, painted lines, nets, tiered stands with
// an instanced crowd, roof floodlights, LED boards, HDRI ambience; world materials are tone-mapped (ACES) in-shader
// so the overlay graphics drawn on top keep their exact broadcast colours.
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { HDRLoader } from 'three/examples/jsm/loaders/HDRLoader.js';
import { FONT, W as FW } from './tokens';

export const L = 105, W = 68;
// data (x, y, z-up) -> three (x, y-up, z toward broadcast camera)
export const toWorld = (x: number, y: number, z = 0, v = new THREE.Vector3()) => v.set(x, z, -y);

// ---------- filmic: ACES tone mapping inside world materials only ----------
export const EXPOSURE = { value: 1.0 };
export function filmic<T extends THREE.Material>(m: T, key: string, patch?: (s: THREE.WebGLProgramParametersWithUniforms) => void): T {
  m.onBeforeCompile = (s) => {
    patch?.(s);
    s.uniforms.uExposure = EXPOSURE;
    s.fragmentShader = s.fragmentShader
      .replace('void main() {', `uniform float uExposure;
        vec3 cpACES(vec3 x) { x *= uExposure * 0.6; return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0); }
        void main() {`)
      .replace('#include <tonemapping_fragment>', 'gl_FragColor.rgb = cpACES(gl_FragColor.rgb);');
  };
  m.customProgramCacheKey = () => `filmic-${key}`;
  return m;
}

// ---------- shared assets (loaded once; every view/renderer reuses them) ----------
const tl = new THREE.TextureLoader();
const [grassCol, grassNrm, grassRgh, hdr] = await Promise.all([
  tl.loadAsync('assets/textures/grass/color.jpg'), tl.loadAsync('assets/textures/grass/normal.jpg'),
  tl.loadAsync('assets/textures/grass/roughness.jpg'), new HDRLoader().loadAsync('assets/hdri/kloppenheim_02_puresky_1k.hdr'),
  document.fonts.load(`${FW.strong} 40px ${FONT}`), // LED board text is drawn into a canvas: load the face first
]);
grassCol.colorSpace = THREE.SRGBColorSpace;
for (const t of [grassCol, grassNrm, grassRgh]) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8; }
hdr.mapping = THREE.EquirectangularReflectionMapping;

const M = 7, TW = L + 2 * M, TH = W + 2 * M; // pitch + runoff (m)
let _lines: HTMLCanvasElement | null = null, _noise: HTMLCanvasElement | null = null, _crowd: HTMLCanvasElement | null = null;

// painted markings as a mask (white on black)
function lineCanvas() {
  if (_lines) return _lines;
  const PX = 34, c = (_lines = document.createElement('canvas'));
  c.width = Math.round(TW * PX); c.height = Math.round(TH * PX);
  const g = c.getContext('2d')!;
  const sx = (x: number) => (x + TW / 2) * PX, sy = (y: number) => (TH / 2 - y) * PX;
  g.fillStyle = '#000'; g.fillRect(0, 0, c.width, c.height);
  g.strokeStyle = '#fff'; g.fillStyle = '#fff'; g.lineWidth = 0.12 * PX;
  const rect = (x0: number, y0: number, x1: number, y1: number) => g.strokeRect(sx(x0), sy(y1), (x1 - x0) * PX, (y1 - y0) * PX);
  const arc = (x: number, y: number, r: number, a0 = 0, a1 = Math.PI * 2) => { g.beginPath(); g.arc(sx(x), sy(y), r * PX, a0, a1); g.stroke(); };
  const dot = (x: number, y: number) => { g.beginPath(); g.arc(sx(x), sy(y), 0.2 * PX, 0, 7); g.fill(); };
  rect(-L / 2, -W / 2, L / 2, W / 2);
  g.beginPath(); g.moveTo(sx(0), sy(W / 2)); g.lineTo(sx(0), sy(-W / 2)); g.stroke();
  arc(0, 0, 9.15); dot(0, 0);
  for (const s of [-1, 1]) {
    const gx = (s * L) / 2;
    rect(Math.min(gx, gx - s * 16.5), -20.16, Math.max(gx, gx - s * 16.5), 20.16);
    rect(Math.min(gx, gx - s * 5.5), -9.16, Math.max(gx, gx - s * 5.5), 9.16);
    dot(gx - s * 11, 0);
    const a = Math.acos(5.5 / 9.15);
    if (s > 0) arc(gx - 11, 0, 9.15, Math.PI - a, Math.PI + a); else arc(gx + 11, 0, 9.15, -a, a);
    for (const t of [-1, 1]) {
      const cy = (t * W) / 2, start = s > 0 ? (t > 0 ? Math.PI / 2 : Math.PI) : t > 0 ? 0 : -Math.PI / 2;
      arc(gx, cy, 1, start, start + Math.PI / 2);
    }
  }
  return c;
}

// tileable smooth value noise for macro grass variation and wear
function noiseCanvas() {
  if (_noise) return _noise;
  const N = 256, c = (_noise = document.createElement('canvas')); c.width = c.height = N;
  const g = c.getContext('2d')!, img = g.createImageData(N, N);
  let seed = 7; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const oct = [8, 16, 32, 64].map((s) => ({ s, v: Array.from({ length: s * s }, rnd) }));
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    let v = 0, amp = 0.5, tot = 0;
    for (const { s, v: grid } of oct) {
      const fx = (x / N) * s, fy = (y / N) * s, x0 = Math.floor(fx), y0 = Math.floor(fy), tx = fx - x0, ty = fy - y0;
      const at = (i: number, j: number) => grid[((j % s) * s + (i % s))];
      const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
      v += amp * ((at(x0, y0) * (1 - sx) + at(x0 + 1, y0) * sx) * (1 - sy) + (at(x0, y0 + 1) * (1 - sx) + at(x0 + 1, y0 + 1) * sx) * sy);
      tot += amp; amp *= 0.5;
    }
    const k = (y * N + x) * 4; img.data[k] = img.data[k + 1] = img.data[k + 2] = (v / tot) * 255; img.data[k + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  return c;
}

function pitchMaterial(renderer: THREE.WebGLRenderer) {
  const lines = new THREE.CanvasTexture(lineCanvas()); lines.anisotropy = renderer.capabilities.getMaxAnisotropy();
  const noise = new THREE.CanvasTexture(noiseCanvas()); noise.wrapS = noise.wrapT = THREE.RepeatWrapping;
  const rep = new THREE.Vector2(TW / 3.2, TH / 3.2);
  const nrm = grassNrm.clone(), rgh = grassRgh.clone();
  for (const t of [nrm, rgh]) { t.repeat.copy(rep); t.needsUpdate = true; }
  const m = new THREE.MeshStandardMaterial({ map: grassCol, normalMap: nrm, normalScale: new THREE.Vector2(0.55, 0.55), roughnessMap: rgh,
    roughness: 1.0, color: new THREE.Color(0.45, 0.62, 0.36), envMapIntensity: 0.5 });
  return filmic(m, 'pitch', (s) => {
    Object.assign(s.uniforms, { lineMap: { value: lines }, noiseMap: { value: noise } });
    s.vertexShader = s.vertexShader.replace('#include <common>', '#include <common>\nvarying vec2 vPUv;')
      .replace('#include <uv_vertex>', '#include <uv_vertex>\nvPUv = uv;');
    s.fragmentShader = s.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec2 vPUv;\nuniform sampler2D lineMap, noiseMap;')
      .replace('#include <map_fragment>', `
        vec2 pm = vec2((vPUv.x - 0.5) * ${TW.toFixed(1)}, (vPUv.y - 0.5) * ${TH.toFixed(1)}); // pitch metres (data x, y)
        vec3 g = texture2D(map, pm / 3.2).rgb;
        float macro = texture2D(noiseMap, pm / 41.0).r * 0.6 + texture2D(noiseMap, pm / 13.0 + 0.37).r * 0.4;
        g *= 0.82 + 0.34 * macro;                                   // breaks up tiling, uneven turf
        float band = mod(floor((pm.x + 52.5) / 5.25), 2.0) * 2.0 - 1.0;
        vec3 V = normalize(cameraPosition - vec3(pm.x, 0.0, -pm.y));
        g *= 1.0 + band * (0.06 + 0.10 * abs(V.z));                  // mowing sheen: blades lean toward/away from camera
        float zone = smoothstep(10.0, 2.0, abs(pm.y)) * smoothstep(40.0, 51.0, abs(pm.x)) + 0.55 * smoothstep(11.0, 0.0, length(pm));
        float n = texture2D(noiseMap, pm / 4.5).r;
        float wear = clamp(zone * (n * 1.7 - 0.45), 0.0, 1.0);
        g = mix(g, vec3(0.30, 0.25, 0.13) * (0.75 + 0.5 * n), wear * 0.5); // worn goalmouths and centre spot
        float line = texture2D(lineMap, vPUv).r;
        g = mix(g, vec3(0.78, 0.8, 0.76) / vec3(0.45, 0.62, 0.36), line * 0.92); // painted lines (undo grass tint)
        diffuseColor.rgb *= g;`);
  });
}

function crowdCanvas() {
  if (_crowd) return _crowd;
  // 8 seated-fan sprites in one atlas (grey shirts; colour comes per instance)
  const c = (_crowd = document.createElement('canvas')); c.width = 512; c.height = 128;
  const g = c.getContext('2d')!;
  const skin = ['#e8c2a0', '#c99572', '#9a6440', '#6a4128', '#f0d0b4', '#b57c55', '#7d4e2e', '#dcae8a'];
  const hair = ['#1b1410', '#3a2716', '#6b4a2a', '#9a7a48', '#151515', '#2a1d14', '#c9a56c', '#444'];
  for (let i = 0; i < 8; i++) {
    const x0 = i * 64;
    g.fillStyle = '#d0d0d0'; g.beginPath(); g.ellipse(x0 + 32, 104, 22 + (i % 3) * 2, 32, 0, Math.PI, 0); g.fill(); g.fillRect(x0 + 10, 104, 44, 24);
    g.fillStyle = skin[i]; g.beginPath(); g.arc(x0 + 32, 56, 13, 0, 7); g.fill();
    g.fillStyle = hair[i]; g.beginPath(); g.arc(x0 + 32, 52, 13.5, Math.PI * 1.05, Math.PI * 1.95); g.fill();
    if (i % 4 === 1) { g.fillStyle = '#d0d0d0'; g.fillRect(x0 + 6, 30, 7, 50); } // arm up
  }
  return c;
}

function stand(len: number, rows: number, crowdColors: THREE.Color[], lite: boolean) {
  const grp = new THREE.Group();
  const step = 0.85, rise = 0.5;
  // stepped concrete tiers (profile in z/y, extruded along x)
  const sh = new THREE.Shape(); sh.moveTo(0, 0); sh.lineTo(0, 1.2);
  for (let r = 0; r < rows; r++) { sh.lineTo(-r * step, 1.2 + r * rise + rise); sh.lineTo(-(r + 1) * step, 1.2 + r * rise + rise); }
  sh.lineTo(-rows * step, 0); sh.closePath();
  const tiers = new THREE.Mesh(new THREE.ExtrudeGeometry(sh, { depth: len, bevelEnabled: false }),
    filmic(new THREE.MeshStandardMaterial({ color: 0x2a2e36, roughness: 0.95 }), 'concrete'));
  tiers.rotation.y = -Math.PI / 2; tiers.position.x = len / 2; tiers.receiveShadow = !lite; grp.add(tiers);
  // instanced crowd on the steps; a few empty seats; gentle per-fan sway in the vertex shader
  const seats = Math.floor(len / 0.62), n = seats * rows;
  const tex = new THREE.CanvasTexture(crowdCanvas()); tex.colorSpace = THREE.SRGBColorSpace;
  const mat = filmic(new THREE.MeshBasicMaterial({ map: tex, alphaTest: 0.5, fog: true }), 'crowd', (s) => {
    s.uniforms.uTime = CROWD_TIME;
    s.vertexShader = s.vertexShader.replace('#include <common>', '#include <common>\nuniform float uTime;')
      .replace('#include <uv_vertex>', '#include <uv_vertex>\nvMapUv.x = (vMapUv.x + float(gl_InstanceID % 8)) / 8.0;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nfloat ph = float(gl_InstanceID) * 1.37;\n'
        + 'transformed.y += 0.035 * sin(uTime * 2.1 + ph) * step(0.0, position.y);\ntransformed.x += 0.03 * sin(uTime * 1.3 + ph * 0.7) * step(0.0, position.y);');
  });
  const crowd = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.58, 0.95).translate(0, 0.47, 0), mat, n);
  const m4 = new THREE.Matrix4(), col = new THREE.Color();
  let k = 0, seed = len * 13;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let r = 0; r < rows; r++) for (let i = 0; i < seats; i++) {
    const empty = rnd() < 0.06;
    const standing = rnd() < 0.12 ? 1.35 : 1; // some fans on their feet
    m4.makeScale(empty ? 0 : (0.86 + rnd() * 0.28) * (standing > 1 ? 0.95 : 1), empty ? 0 : (0.85 + rnd() * 0.3) * standing, 1)
      .setPosition(-len / 2 + (i + 0.5) * (len / seats) + (rnd() - 0.5) * 0.3, 1.2 + r * rise + rise + 0.05 + (rnd() - 0.5) * 0.06, -(r + 0.45 + rnd() * 0.2) * step);
    crowd.setMatrixAt(k, m4);
    // lit by the floodlights near the front, darker toward the back under the roof
    const light = 0.4 - (r / rows) * 0.22;
    crowd.setColorAt(k, col.copy(crowdColors[Math.floor(rnd() * crowdColors.length)]).lerp(GREY, 0.35).multiplyScalar(light * (0.7 + rnd() * 0.5)));
    k++;
  }
  grp.add(crowd);
  const depth = rows * step, top = 1.2 + rows * rise + rise;
  const concrete = filmic(new THREE.MeshStandardMaterial({ color: 0x16191f, roughness: 0.9 }), 'concrete2');
  const back = new THREE.Mesh(new THREE.BoxGeometry(len, top + 10, 1), concrete); back.position.set(0, (top + 10) / 2, -depth - 0.5); grp.add(back);
  const front = new THREE.Mesh(new THREE.BoxGeometry(len, 1.25, 0.3), concrete); front.position.set(0, 0.62, 0.1); grp.add(front);
  // roof: dark underside with a lit fascia and a row of floodlight heads (HDR emissive -> bloom)
  const roofY = top + 9;
  const roof = new THREE.Mesh(new THREE.BoxGeometry(len + 4, 0.6, depth + 6), concrete); roof.position.set(0, roofY, -depth / 2 + 2); grp.add(roof);
  const fascia = new THREE.Mesh(new THREE.BoxGeometry(len + 4, 1.6, 0.4), filmic(new THREE.MeshStandardMaterial({ color: 0x3a3f48, roughness: 0.6 }), 'fascia'));
  fascia.position.set(0, roofY - 0.5, 5); grp.add(fascia);
  const lamp = new THREE.MeshBasicMaterial({ color: new THREE.Color(2.2, 2.1, 1.9), toneMapped: false });
  const lampGeo = new THREE.BoxGeometry(0.9, 0.5, 0.25);
  const lamps = new THREE.InstancedMesh(lampGeo, lamp, Math.floor(len / 2.4));
  for (let i = 0; i < lamps.count; i++) lamps.setMatrixAt(i, m4.makeTranslation(-len / 2 + (i + 0.5) * 2.4, roofY - 1.5, 5.15));
  grp.add(lamps);
  return grp;
}

function boardTexture(home: string, away: string) {
  // LED perimeter boards: neutral fictional content on a pixel grid
  const c = document.createElement('canvas'); c.width = 2048; c.height = 64;
  const g = c.getContext('2d')!;
  g.fillStyle = '#06101f'; g.fillRect(0, 0, c.width, c.height);
  g.font = `${FW.strong} 36px ${FONT}`; g.textBaseline = 'middle';
  const words = [home.toUpperCase(), 'COUNTERPLAY', away.toUpperCase(), 'MATCH ENGINE'];
  let x = 40;
  for (let i = 0; x < c.width; i++) { const w = words[i % words.length]; g.fillStyle = i % 2 ? '#9fdcff' : '#f2f5fa'; g.fillText(w, x, 34); x += g.measureText(w).width + 120; }
  g.fillStyle = 'rgba(0,0,0,0.45)';
  for (let y = 0; y < 64; y += 4) g.fillRect(0, y, c.width, 1);
  for (let xx = 0; xx < c.width; xx += 4) g.fillRect(xx, 0, 1, 64);
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace; tex.wrapS = THREE.RepeatWrapping; tex.anisotropy = 8;
  return tex;
}

function netTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d')!; g.strokeStyle = 'rgba(255,255,255,0.8)'; g.lineWidth = 1.6;
  g.beginPath(); g.moveTo(0, 32); g.lineTo(32, 0); g.lineTo(64, 32); g.lineTo(32, 64); g.closePath(); g.stroke(); // diamond mesh
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; return t;
}

function goal(side: number) {
  const grp = new THREE.Group();
  const white = filmic(new THREE.MeshStandardMaterial({ color: 0xf4f4f4, roughness: 0.35 }), 'post');
  const gw = 7.32, depth = 2.2, r = 0.06;
  const post = new THREE.CylinderGeometry(r, r, 2.44, 16);
  for (const t of [-1, 1]) { const p = new THREE.Mesh(post, white); p.position.set(0, 1.22, (t * gw) / 2); p.castShadow = true; grp.add(p); }
  const bar = new THREE.Mesh(new THREE.CylinderGeometry(r, r, gw + 2 * r, 16), white);
  bar.rotation.x = Math.PI / 2; bar.position.set(0, 2.44, 0); bar.castShadow = true; grp.add(bar);
  // net: sloped roof/back + sides, diamond mesh, slight sag
  const nt = netTexture();
  const netMat = (rx: number, ry: number) => { const t = nt.clone(); t.repeat.set(rx, ry); t.needsUpdate = true;
    return filmic(new THREE.MeshStandardMaterial({ map: t, transparent: true, side: THREE.DoubleSide, depthWrite: false, opacity: 0.55, roughness: 1 }), 'net'); };
  const back = new THREE.Mesh(new THREE.PlaneGeometry(gw, 2.2, 8, 4), netMat(60, 18));
  back.position.set(depth, 1.0, 0); back.rotation.y = -Math.PI / 2; back.rotation.x = 0.0; grp.add(back);
  const top = new THREE.Mesh(new THREE.PlaneGeometry(depth, gw), netMat(18, 60));
  top.rotation.x = -Math.PI / 2; top.rotation.y = -0.12; top.position.set(depth / 2, 2.32, 0); grp.add(top);
  for (const t of [-1, 1]) {
    const s = new THREE.Mesh(new THREE.PlaneGeometry(depth, 2.44), netMat(18, 20)); s.position.set(depth / 2, 1.22, (t * gw) / 2); grp.add(s);
  }
  grp.position.set((side * L) / 2, 0, 0);
  grp.rotation.y = side > 0 ? 0 : Math.PI;
  return grp;
}

export const CROWD_TIME = { value: 0 };
// quality: the recorder (capture=1) renders 'high' (two shadow-casting floodlights); realtime defaults to 'medium'
const _q = new URLSearchParams(location.search);
export const QUALITY = (_q.get('quality') ?? (_q.get('capture') === '1' ? 'high' : 'medium')) as 'high' | 'medium';
const GREY = new THREE.Color(0.35, 0.35, 0.37);

// lite: multi-view (split/quad) budget, smaller shadow maps and a single shadow caster
export function buildStadium(renderer: THREE.WebGLRenderer, scene: THREE.Scene, names: [string, string], lite = false) {
  scene.background = hdr; scene.backgroundIntensity = 0.18;
  scene.environment = hdr; scene.environmentIntensity = 0.25;
  scene.fog = new THREE.Fog(0x0d1626, 110, 330); // faint haze under the floodlights

  const pitch = new THREE.Mesh(new THREE.PlaneGeometry(TW, TH), pitchMaterial(renderer));
  pitch.rotation.x = -Math.PI / 2; pitch.receiveShadow = true; scene.add(pitch);
  const apron = new THREE.Mesh(new THREE.PlaneGeometry(260, 220), filmic(new THREE.MeshStandardMaterial({ color: 0x0f1a12, roughness: 1 }), 'apron'));
  apron.rotation.x = -Math.PI / 2; apron.position.y = -0.02; scene.add(apron);
  scene.add(goal(1), goal(-1));

  // LED boards
  const btex = boardTexture(names[0], names[1]);
  const boardMat = (rep: number) => { const t = btex.clone(); t.repeat.set(rep, 1); t.needsUpdate = true;
    return new THREE.MeshBasicMaterial({ map: t, color: new THREE.Color(0.95, 0.95, 0.95), toneMapped: false }); };
  const boards: [number, number, number, number, number][] = [
    [0, -(W / 2 + 4.5), L + 6, 0, 2], [0, W / 2 + 4.5, L + 6, Math.PI, 2],
    [L / 2 + 5, 0, W - 10, -Math.PI / 2, 1.2], [-(L / 2 + 5), 0, W - 10, Math.PI / 2, 1.2]];
  const boardBody = filmic(new THREE.MeshStandardMaterial({ color: 0x111317, roughness: 0.7 }), 'board');
  for (const [x, z, len, ry, rep] of boards) {
    const b = new THREE.Mesh(new THREE.PlaneGeometry(len, 0.9), boardMat(rep)); b.position.set(x, 0.5, z); b.rotation.y = ry; scene.add(b);
    const box = new THREE.Mesh(new THREE.BoxGeometry(len, 1.0, 0.3), boardBody); box.position.set(x, 0.5, z); box.rotation.y = ry; box.translateZ(-0.16); scene.add(box);
  }

  // stands: tiers start ~9 m behind the touchlines, crowd in home/away/neutral colours
  const crowdCols = ['#d7263d', '#2e86de', '#e9e9e9', '#24262c', '#3b3f48', '#8a1c2b', '#1c4f8a', '#c8b07a'].map((c) => new THREE.Color(c));
  const sides: [number, number, number, number, number][] = [ // x, z, length, rotY, rows
    [0, -(W / 2 + 9), L + 30, 0, 34], [0, W / 2 + 9, L + 30, Math.PI, 26], [L / 2 + 10, 0, W + 18, -Math.PI / 2, 30], [-(L / 2 + 10), 0, W + 18, Math.PI / 2, 30]];
  for (const [x, z, len, ry, rows] of sides) { const s = stand(len, rows, crowdCols, lite); s.position.set(x, 0, z); s.rotation.y = ry; scene.add(s); }
  // corner stands close the bowl (no black gaps between the four sides)
  for (const [cx, cz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
    const c = stand(30, 28, crowdCols, lite);
    c.position.set(cx * (L / 2 + 9), 0, cz * (W / 2 + 7)); c.rotation.y = Math.atan2(-cx, -cz); scene.add(c);
  }

  // floodlights: two shadow-casting keys from opposite roof corners (soft double shadows) + cool fill
  scene.add(new THREE.HemisphereLight(0x8fa6cc, 0x0b140c, 0.18));
  const key = (x: number, z: number, i: number, shadow: boolean) => {
    const l = new THREE.DirectionalLight(0xfff3e2, i);
    l.position.set(x, 75, z); l.castShadow = shadow;
    if (shadow) {
      l.shadow.mapSize.setScalar(lite ? 1024 : 2048);
      Object.assign(l.shadow.camera, { left: -62, right: 62, top: 42, bottom: -42, near: 20, far: 220 });
      l.shadow.bias = -0.0004; l.shadow.normalBias = 0.03; l.shadow.radius = 2;
    }
    scene.add(l);
  };
  key(-45, 50, 2.3, true);
  key(45, -45, 1.5, !lite && QUALITY === 'high');
  key(40, 55, 0.6, false);
  key(-40, -50, 0.5, false);
}

// broadcast grade: gentle S-curve, warm highlights / cool shadows, light grain, vignette.
// Bloom only catches HDR (>1) colours: graphics, LED boards, floodlights (world is tone-mapped to <=1 in-shader).
const GradeShader = {
  uniforms: { tDiffuse: { value: null }, vignette: { value: 0.32 }, desat: { value: 0 }, tint: { value: new THREE.Vector3(1, 1, 1) }, seed: { value: 0 } },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.); }`,
  fragmentShader: `uniform sampler2D tDiffuse; uniform float vignette; uniform float desat; uniform vec3 tint; uniform float seed; varying vec2 vUv;
    float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233)) + seed * 91.7) * 43758.5453); }
    void main(){ vec4 c = texture2D(tDiffuse, vUv);
      float l = dot(c.rgb, vec3(0.2126,0.7152,0.0722));
      c.rgb = mix(c.rgb, c.rgb * c.rgb * (3.0 - 2.0 * c.rgb), 0.12);                  // S-curve
      c.rgb *= mix(vec3(0.97, 1.0, 1.04), vec3(1.03, 1.0, 0.97), smoothstep(0.1, 0.7, l)); // split tone
      c.rgb = mix(c.rgb, vec3(l) * vec3(0.92,1.0,0.96), desat) * tint;
      vec2 d = vUv - 0.5; float v = smoothstep(0.85, 0.2, length(d * vec2(1.0, 0.8)));
      c.rgb *= mix(1.0 - vignette, 1.0, v);
      c.rgb += (hash(gl_FragCoord.xy) - 0.5) * 0.018;                                // sensor grain
      gl_FragColor = c; }`,
};

export function makeComposer(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera, samples = 4) {
  const rt = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples });
  const composer = new EffectComposer(renderer, rt);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.4, 0.45, 1.0);
  composer.addPass(bloom);
  const grade = new ShaderPass(GradeShader);
  composer.addPass(grade);
  composer.addPass(new OutputPass());
  // per-frame grain seed + crowd sway clock (frame-counted, so recorder takes stay deterministic)
  const render = composer.render.bind(composer);
  composer.render = (dt?: number) => { grade.uniforms.seed.value = (grade.uniforms.seed.value + 0.6180339) % 1; CROWD_TIME.value += 1 / 30; render(dt); };
  return { composer, grade, bloom };
}
