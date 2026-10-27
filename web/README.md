# web: broadcast renderer

Three.js + TypeScript (Vite). It plays `data/<name>.json` (see `../data/FORMAT.md`) with TV-style graphics anchored in the 3D scene.

```bash
npm install
npm run dev            # http://localhost:5173  (serves ../data at /data)
npm run mock           # optional: writes ../data/mock.json + fork-mock.json (dev-only generator)
```

URL params: `?match=match&fork=fork-step_up` and optionally `view=split|ghost|single`, `cam=broadcast|tactical|player`,
`lens=0..1`, `t=<sec>`, `paused=1`, `ui=0` (hides the control bar for filming), `sel=away:5`, `loop=0`.
`match` defaults to `match`, falling back to `mock`. When a fork is loaded, playback loops from fork−5 s to fork+10 s, and the player named in `forkOf.params.player` is highlighted.

Keys: `space` play/pause · `1/2/3` broadcast/tactical/player cam · `←/→` ±5 s · `c`/`t` lens casual/tactical ·
`s`/`g`/`m` split/ghost/match · `f` jump to the fork · `h` hide UI · click a player to select him (`esc` clears).

Modules (`src/`): `data` (load, interpolation, formation/line/offside metrics), `scene` (stadium, lights, post-processing),
`players` (figures, ball, trail, ghosts), `graphics` (3D overlays with lens weights), `cameras` (rig + blends),
`hud` (DOM overlay), `main` (views, split/ghost, loop, controls).

Screenshots: `npm run shots`. This needs a running server plus a Chrome that works headless. The snap chromium on the box does not, so use:
```bash
npx @puppeteer/browsers install chrome-headless-shell@stable --path /tmp/pl-browsers
CHROME=$(ls /tmp/pl-browsers/chrome-headless-shell/*/chrome-headless-shell-linux64/chrome-headless-shell) \
  BASE=http://localhost:5173 T=64.5 npm run shots
```
