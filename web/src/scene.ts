// Night stadium: striped pitch with markings, goals, LED boards, stands, floodlights, lights + post chain.
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';

export const L = 105, W = 68;
// data (x, y, z-up) -> three (x, y-up, z toward broadcast camera)
export const toWorld = (x: number, y: number, z = 0, v = new THREE.Vector3()) => v.set(x, z, -y);

// canvases are drawn once and shared by every view (quad = 4 renderers); each renderer gets its own texture
let _pitch: HTMLCanvasElement | null = null, _crowd: HTMLCanvasElement | null = null;
function pitchTexture(renderer: THREE.WebGLRenderer) {
  const PX = 34, M = 7, TW = L + 2 * M, TH = W + 2 * M; // px per metre, runoff margin
  const cached = !!_pitch, c = (_pitch ??= document.createElement('canvas'));
  if (!cached) {
  c.width = Math.round(TW * PX); c.height = Math.round(TH * PX);
  const g = c.getContext('2d')!;
  const sx = (x: number) => (x + TW / 2) * PX, sy = (y: number) => (TH / 2 - y) * PX;
  g.fillStyle = '#1f5a26'; g.fillRect(0, 0, c.width, c.height);
  // mowing stripes (vertical bands across the pitch), runoff slightly darker
  const bands = 18, bw = L / bands;
  for (let i = 0; i < bands; i++) {
    g.fillStyle = i % 2 ? '#2a7231' : '#24662b';
    g.fillRect(sx(-L / 2 + i * bw), sy(W / 2 + M), bw * PX + 1, TH * PX);
  }
  g.fillStyle = 'rgba(8,20,10,0.35)';
  g.fillRect(0, 0, c.width, M * PX); g.fillRect(0, c.height - M * PX, c.width, M * PX);
  g.fillRect(0, 0, M * PX, c.height); g.fillRect(c.width - M * PX, 0, M * PX, c.height);
  // grass grain
  const img = g.getImageData(0, 0, c.width, c.height), d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (Math.random() - 0.5) * 18;
    d[i] += n * 0.5; d[i + 1] += n; d[i + 2] += n * 0.4;
  }
  g.putImageData(img, 0, 0);
  // markings
  g.strokeStyle = 'rgba(245,248,240,0.92)'; g.fillStyle = g.strokeStyle; g.lineWidth = 0.12 * PX;
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
    const a = Math.acos(5.5 / 9.15); // penalty arc outside the box
    if (s > 0) arc(gx - 11, 0, 9.15, Math.PI - a, Math.PI + a); else arc(gx + 11, 0, 9.15, -a, a);
    for (const t of [-1, 1]) {
      const cy = (t * W) / 2, start = s > 0 ? (t > 0 ? Math.PI / 2 : Math.PI) : t > 0 ? 0 : -Math.PI / 2;
      arc(gx, cy, 1, start, start + Math.PI / 2);
    }
  }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
  return { tex, TW, TH };
}

function crowdTexture() {
  const cached = !!_crowd, c = (_crowd ??= document.createElement('canvas'));
  if (!cached) {
  c.width = 1024; c.height = 256;
  const g = c.getContext('2d')!;
  g.fillStyle = '#0d1018'; g.fillRect(0, 0, c.width, c.height);
  const cols = ['#8a1c2b', '#c42b3c', '#1c4f8a', '#2e6fb8', '#d9d9d9', '#3a3f4a', '#6b6f78', '#e0b84c'];
  for (let y = 4; y < c.height; y += 8)
    for (let x = 2 + ((y / 8) % 2) * 3; x < c.width; x += 6) {
      g.fillStyle = cols[(Math.random() * cols.length) | 0];
      g.globalAlpha = 0.18 + Math.random() * 0.22;
      g.fillRect(x, y, 4, 5);
    }
  g.globalAlpha = 1;
  // seat-row banding reads as tiers at distance
  for (let y = 0; y < c.height; y += 16) { g.fillStyle = 'rgba(0,0,0,0.35)'; g.fillRect(0, y, c.width, 3); }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace; tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

function boardTexture(home: string, away: string) {
  const c = document.createElement('canvas'); c.width = 2048; c.height = 64;
  const g = c.getContext('2d')!;
  const grad = g.createLinearGradient(0, 0, c.width, 0);
  grad.addColorStop(0, '#071a33'); grad.addColorStop(0.5, '#0b2f5c'); grad.addColorStop(1, '#071a33');
  g.fillStyle = grad; g.fillRect(0, 0, c.width, c.height);
  g.font = '700 40px "Barlow Condensed", sans-serif'; g.textBaseline = 'middle';
  const words = [`${home.toUpperCase()}`, 'WHAT IF · MATCH ENGINE', `${away.toUpperCase()}`, 'LIVE TRACKING'];
  let x = 30;
  for (let i = 0; x < c.width; i++) {
    const w = words[i % words.length];
    g.fillStyle = i % 2 ? '#7fd4ff' : '#ffffff';
    g.fillText(w, x, 34); x += g.measureText(w).width + 70;
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace; tex.wrapS = THREE.RepeatWrapping;
  return tex;
}

function goal(side: number) {
  const grp = new THREE.Group();
  const white = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.3, emissive: 0x333333 });
  const post = new THREE.CylinderGeometry(0.06, 0.06, 2.44, 10);
  const gw = 7.32, depth = 2.2;
  for (const t of [-1, 1]) {
    const p = new THREE.Mesh(post, white); p.position.set(0, 1.22, (t * gw) / 2); p.castShadow = true; grp.add(p);
  }
  const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, gw, 10), white);
  bar.rotation.x = Math.PI / 2; bar.position.set(0, 2.44, 0); bar.castShadow = true; grp.add(bar);
  // net: grid texture on the inside of a box
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d')!; g.strokeStyle = 'rgba(255,255,255,0.55)'; g.lineWidth = 2; g.strokeRect(0, 0, 64, 64);
  const nt = new THREE.CanvasTexture(c); nt.wrapS = nt.wrapT = THREE.RepeatWrapping; nt.repeat.set(30, 12);
  const net = new THREE.Mesh(new THREE.BoxGeometry(depth, 2.44, gw),
    new THREE.MeshBasicMaterial({ map: nt, transparent: true, side: THREE.DoubleSide, depthWrite: false, opacity: 0.6 }));
  net.position.set(depth / 2, 1.22, 0); grp.add(net);
  grp.position.set((side * L) / 2, 0, 0);
  grp.rotation.y = side > 0 ? 0 : Math.PI;
  return grp;
}

// lite: multi-view (split/quad) budget, smaller shadow map
export function buildStadium(renderer: THREE.WebGLRenderer, scene: THREE.Scene, names: [string, string], lite = false) {
  scene.background = new THREE.Color(0x0a1222);
  scene.fog = new THREE.Fog(0x0a1222, 150, 330);

  const { tex, TW, TH } = pitchTexture(renderer);
  const pitch = new THREE.Mesh(new THREE.PlaneGeometry(TW, TH), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.92, metalness: 0 }));
  pitch.rotation.x = -Math.PI / 2; pitch.receiveShadow = true; scene.add(pitch);
  const apron = new THREE.Mesh(new THREE.PlaneGeometry(260, 220), new THREE.MeshStandardMaterial({ color: 0x0c160f, roughness: 1 }));
  apron.rotation.x = -Math.PI / 2; apron.position.y = -0.02; scene.add(apron);
  scene.add(goal(1), goal(-1));

  // LED boards (emissive -> bloom)
  const btex = boardTexture(names[0], names[1]);
  const boardMat = (rep: number) => { const t = btex.clone(); t.repeat.set(rep, 1); t.needsUpdate = true;
    return new THREE.MeshBasicMaterial({ map: t, color: new THREE.Color(1.15, 1.15, 1.15) }); };
  const boards: [number, number, number, number, number][] = [ // x, z, length, rotY, repeat
    [0, -(W / 2 + 4.5), L + 6, 0, 2], [0, W / 2 + 4.5, L + 6, Math.PI, 2],
    [L / 2 + 5, 0, W - 10, -Math.PI / 2, 1.2], [-(L / 2 + 5), 0, W - 10, Math.PI / 2, 1.2]];
  for (const [x, z, len, ry, rep] of boards) {
    const b = new THREE.Mesh(new THREE.PlaneGeometry(len, 0.9), boardMat(rep));
    b.position.set(x, 0.45, z); b.rotation.y = ry; scene.add(b);
  }

  // stands: stepped tiers with a crowd texture, roof fascia with floodlight strip
  const crowd = crowdTexture();
  const standMat = (rep: number) => { const t = crowd.clone(); t.repeat.set(rep, 3); t.needsUpdate = true;
    return new THREE.MeshStandardMaterial({ map: t, roughness: 1, color: 0x9aa0b0, emissiveMap: t, emissive: 0xffffff, emissiveIntensity: 0.45 }); };
  const concrete = new THREE.MeshStandardMaterial({ color: 0x151922, roughness: 0.9 });
  const glow = new THREE.MeshBasicMaterial({ color: new THREE.Color(6, 6, 5.4) });
  const sides: [number, number, number, number][] = [ // centre x, z, length, rotY (facing pitch)
    [0, -(W / 2 + 9), L + 30, 0], [0, W / 2 + 9, L + 30, Math.PI], [L / 2 + 10, 0, W + 22, -Math.PI / 2], [-(L / 2 + 10), 0, W + 22, Math.PI / 2]];
  for (const [x, z, len, ry] of sides) {
    const grp = new THREE.Group();
    const depth = 30, rise = 20, slope = Math.atan2(rise, depth), hyp = Math.hypot(depth, rise);
    const tier = new THREE.Mesh(new THREE.PlaneGeometry(len, hyp), standMat(len / 12));
    tier.position.set(0, rise / 2 + 1.2, -depth / 2); tier.rotation.x = -(Math.PI / 2 - slope); grp.add(tier);
    const back = new THREE.Mesh(new THREE.BoxGeometry(len, 34, 1), concrete); back.position.set(0, 17, -depth - 1); grp.add(back);
    const front = new THREE.Mesh(new THREE.BoxGeometry(len, 1.2, 0.6), concrete); front.position.set(0, 0.6, 0); grp.add(front);
    const roof = new THREE.Mesh(new THREE.BoxGeometry(len, 0.8, 16), concrete); roof.position.set(0, 31, -depth + 7); grp.add(roof);
    const strip = new THREE.Mesh(new THREE.BoxGeometry(len * 0.92, 0.35, 0.35), glow); strip.position.set(0, 30.4, -depth + 15.2); grp.add(strip);
    for (let i = -3; i <= 3; i++) { // floodlight clusters on the fascia
      const f = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.9, 0.2), glow); f.position.set((i * len) / 7.5, 29.6, -depth + 15.1); grp.add(f);
    }
    grp.position.set(x, 0, z); grp.rotation.y = ry; scene.add(grp);
  }

  for (const [cx, cz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
    const pylon = new THREE.Mesh(new THREE.BoxGeometry(5, 3, 0.4), glow);
    pylon.position.set(cx * (L / 2 + 14), 40, cz * (W / 2 + 14)); pylon.lookAt(0, 0, 0); scene.add(pylon);
  }

  // lights: cool fill + one shadowing key, as from the main floodlight bank
  scene.add(new THREE.HemisphereLight(0x9fb4d8, 0x0b140c, 0.55));
  const key = new THREE.DirectionalLight(0xfff6e8, 2.6);
  key.position.set(-30, 70, 45); key.castShadow = true;
  key.shadow.mapSize.setScalar(lite ? 1024 : 2048);
  Object.assign(key.shadow.camera, { left: -70, right: 70, top: 50, bottom: -50, near: 10, far: 200 });
  key.shadow.bias = -0.0004; key.shadow.normalBias = 0.02; key.shadow.radius = 3;
  scene.add(key);
  const rim = new THREE.DirectionalLight(0xcfe0ff, 0.9); rim.position.set(40, 60, -50); scene.add(rim);
}

// bloom only catches HDR (>1) colours: graphics, LED boards, floodlights
const GradeShader = {
  uniforms: { tDiffuse: { value: null }, vignette: { value: 0.32 }, desat: { value: 0 }, tint: { value: new THREE.Vector3(1, 1, 1) } },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.); }`,
  fragmentShader: `uniform sampler2D tDiffuse; uniform float vignette; uniform float desat; uniform vec3 tint; varying vec2 vUv;
    void main(){ vec4 c = texture2D(tDiffuse, vUv);
      float l = dot(c.rgb, vec3(0.2126,0.7152,0.0722));
      c.rgb = mix(c.rgb, vec3(l) * vec3(0.92,1.0,0.96), desat) * tint;
      vec2 d = vUv - 0.5; float v = smoothstep(0.85, 0.2, length(d * vec2(1.0, 0.8)));
      c.rgb *= mix(1.0 - vignette, 1.0, v);
      gl_FragColor = c; }`,
};

export function makeComposer(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera, samples = 4) {
  const rt = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples });
  const composer = new EffectComposer(renderer, rt);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.45, 0.45, 1.0);
  composer.addPass(bloom);
  const grade = new ShaderPass(GradeShader);
  composer.addPass(grade);
  composer.addPass(new OutputPass());
  return { composer, grade, bloom };
}
