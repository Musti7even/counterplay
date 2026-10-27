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

## Static deploy

`npm run build` writes a self-contained `dist/`:
- relative base path, so it runs at a domain root or any subpath;
- `data/*.json`, `data/audio/` and `directors/` are copied in, minus dev mocks and engine checkpoints.

Upload `dist/` to any static host (GitHub Pages, Azure Static Web Apps). Check it locally with:
`cd dist && python3 -m http.server`. Opening the site with no query string shows the **Counterplay** start screen, which links to the four demos. Press `?` for keys.

**Performance:**
- Pixel ratio is capped at 1.5, or 1 in split and quad.
- Split and quad use 2× MSAA and a 1024 shadow map; a single view uses 4× MSAA and a 2048 shadow map.
- The pitch and crowd canvases are drawn once and shared by every view.

## Filming (deterministic, any machine)

```bash
npm run record -- --url '?director=whatif' --out shots/whatif.mp4      # window from the script
npm run record -- --url '?match=match&cam=broadcast&lens=0' --from 60 --to 72 --fps 30 --out shots/x.mp4
```
The recorder builds a frozen copy of the app, opens it with `&capture=1` and steps match time by exactly 1/fps per frame (slow-mo cues add frames).
Each frame is screenshotted in headless Chrome (swiftshader) and piped to ffmpeg (h264, yuv420p, 1920×1080).
On this box that is about 1.5 s per frame, or 2 views ≈ 3 s per frame in split.

**Director cues** (`src/director.ts`, scripts in `public/directors/*.json`, or `?cues=<url>`): a list of
`{ t, cam, cut, lens, lensTo, over, speed, view, select, caption: { title, text, dur } }` keyed on match time.
They are folded from scratch each frame, so scrubbing and recording are exact. Agents can emit the same JSON.

**Agent outputs** (from `../agents`):
- `?cues=/data/<run>.cues.json` plays a run. Its sibling `<run>.commentary.json` is shown as AI commentary subtitles; override it with `?commentary=<url>`, or turn it off with `commentary=0`.
- If `data/audio/<run>/voice.json` exists, its mp3s play in sync, and the recorder mixes them into the mp4 (each clip lands on the first frame whose match time reaches its `t`).
- `&control=1` adds the control-room strip, replaying `<run>.trace.json` (or pass `control=<url>`). Steps are spread by order over `controlAt=a-b` (match seconds).
- `?view=quad[&quad=run1,run2,run3,run4][&from=60&to=72]` shows the same moment for four runs on one clock. The default runs are casual/en, analyst/en, player-a6/de and casual/tr.

**Demo cut:**
1. Render the title cards (`video/cards.html`) with `BASE=<dev server> node scripts/cards.mjs`. They are written to `shots/cards/`.
2. Run `scripts/assemble.sh`. It joins the recorded clips and the cards into `shots/demo-v0.mp4` and prints the segment timeline.

`npm run check` runs the formation snapper self-check.

Screenshots: `npm run shots`. This needs a running server plus a Chrome that works headless. The snap chromium on the box does not, so use:
```bash
npx @puppeteer/browsers install chrome-headless-shell@stable --path ../../.tools/pl-browsers   # found automatically there
BASE=http://localhost:5173 T=64.5 npm run shots
```
