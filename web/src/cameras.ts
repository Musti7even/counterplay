// Camera rig: broadcast (elevated side, lagged pan + play-based zoom), tactical high cam, player follow.
// Each mode keeps its own damped state; switching blends the two live poses with an ease.
import * as THREE from 'three';
import { Side, Snapshot, dirOf } from './data';
import { toWorld } from './scene';

export type CamMode = 'broadcast' | 'tactical' | 'player';
interface Pose { pos: THREE.Vector3; look: THREE.Vector3; fov: number }
const damp = (a: number, b: number, k: number, dt: number) => a + (b - a) * (1 - Math.exp(-k * dt));
const dampV = (a: THREE.Vector3, b: THREE.Vector3, k: number, dt: number) => a.lerp(b, 1 - Math.exp(-k * dt));
const ease = (t: number) => t * t * (3 - 2 * t);

export class CameraRig {
  mode: CamMode = 'broadcast';
  private prev: CamMode = 'broadcast';
  private blend = 1;
  private poses: Record<CamMode, Pose> = {
    broadcast: { pos: new THREE.Vector3(), look: new THREE.Vector3(), fov: 20 },
    tactical: { pos: new THREE.Vector3(), look: new THREE.Vector3(), fov: 40 },
    player: { pos: new THREE.Vector3(), look: new THREE.Vector3(), fov: 42 },
  };
  private snapNext = true;
  tight = false; // split halves: steeper, closer gantry so the pitch fills the narrow frame
  constructor(public cam: THREE.PerspectiveCamera) {}

  set(mode: CamMode, instant = false) {
    if (mode === this.mode) return;
    this.prev = this.mode; this.mode = mode; this.blend = instant ? 1 : 0;
  }
  snap() { this.snapNext = true; }

  update(s: Snapshot, focus: { side: Side; idx: number } | null, dt: number) {
    const k = this.snapNext ? 1e4 : 1;
    if (this.snapNext) { dt = 1; this.blend = 1; }
    this.snapNext = false;
    const ball = toWorld(s.ball[0], s.ball[1], 0);

    // broadcast: fixed gantry on the near side, slight dolly, pans with lag, zooms by how spread the play is
    {
      const p = this.poses.broadcast;
      const near = [...s.pos.home, ...s.pos.away].map((q) => Math.hypot(q[0] - s.ball[0], q[1] - s.ball[1])).sort((a, b) => a - b);
      const spread = near[7];
      const zoomFov = THREE.MathUtils.clamp(10 + spread * 0.62, 14, 25) + (Math.abs(s.ball[0]) > 36 ? 3 : 0);
      dampV(p.look, new THREE.Vector3(THREE.MathUtils.clamp(ball.x, -42, 42), 0, THREE.MathUtils.clamp(ball.z, -14, 16) * 0.75), 2.2 * k, dt);
      dampV(p.pos, this.tight ? new THREE.Vector3(p.look.x * 0.5, 21, 41) : new THREE.Vector3(p.look.x * 0.35, 20, 56), 1.2 * k, dt); // gantry under the near-stand roof
      p.fov = damp(p.fov, this.tight ? zoomFov * 0.95 : zoomFov, 0.8 * k, dt);
    }
    // tactical: high, steep, sees the whole width
    {
      const p = this.poses.tactical, cx = THREE.MathUtils.clamp(ball.x * 0.55, -22, 22);
      dampV(p.look, new THREE.Vector3(cx, 0, 2), 1.5 * k, dt);
      dampV(p.pos, new THREE.Vector3(cx, 92, 48), 1.5 * k, dt);
      p.fov = 40;
    }
    // player: low chase cam behind the focus player, framing player + ball
    {
      const p = this.poses.player, f = focus ?? (s.owner ? { side: s.owner.team, idx: s.owner.idx } : { side: 'home' as Side, idx: 9 });
      const [px, py] = s.pos[f.side][f.idx], d = dirOf(f.side), pw = toWorld(px, py, 0);
      const look = pw.clone().lerp(ball, 0.35); look.y = 1.2;
      dampV(p.look, look, 3 * k, dt);
      dampV(p.pos, new THREE.Vector3(pw.x - d * 13, 7.5, pw.z + 9), 2 * k, dt);
      p.fov = 42;
    }

    this.blend = Math.min(1, this.blend + dt / 1.4);
    const a = this.poses[this.prev], b = this.poses[this.mode], t = ease(this.blend);
    // arc the transition upward a little so cuts feel like a crane move, not a slide
    const lift = Math.sin(t * Math.PI) * (this.prev !== this.mode ? 12 : 0);
    this.cam.position.lerpVectors(a.pos, b.pos, t).y += lift;
    const look = new THREE.Vector3().lerpVectors(a.look, b.look, t);
    this.cam.fov = a.fov + (b.fov - a.fov) * t;
    // narrow viewports (split view): widen a bit and aim nearer so the pitch, not the stands, fills the frame
    const narrow = this.tight ? 1 : Math.max(1, Math.pow(1.6 / this.cam.aspect, 0.3));
    this.cam.fov *= narrow; look.z += (narrow - 1) * 60;
    this.cam.lookAt(look);
    this.cam.updateProjectionMatrix();
  }
}
