# Counterplay graphics system

One small system for every on-air graphic. Reference: modern top-flight football broadcast graphics (deep purple-black plates,
white type, one electric signal colour used sparingly, team colour as a thin bar). Evoked, not copied: no league marks, crests,
sponsor marks or proprietary fonts.

Sources: `src/tokens.css` (CSS custom properties) and `src/tokens.ts` (the same values for canvas/three.js).
Component sheet: `design.html` (dev server) → `shots/design-sheet.png`.

## Tokens

### Colour: every colour has one meaning

| token | value | meaning, and only this |
|---|---|---|
| `--surface` | `#140722` @ 94 % | every plate on air |
| `--surface-solid` | `#140722` | the same surface with nothing behind it: full-screen cards, gallery strip, app chrome |
| `--surface-2` | `#2a0f47` | a nested segment inside a plate: score, card head, a value segment, an agent card |
| `--text` | `#ffffff` | values, names, headlines; neutral pitch lines |
| `--text-2` | white @ 62 % | labels, units, kickers, secondary lines |
| `--rule` | white @ 12 % | hairline dividers |
| `--accent` | `#38ff8b` | **live focus**: the one subject the picture is about right now (selected player, the agent working now, a live value such as a sprint speed, a fresh goal) |
| `--alert` | `#ffb020` | **risk**: pressure on the ball, a misplaced pass, an agent failure/recovery, a claim that did not air |
| `--whatif` | `#34ddff` | **alternate timeline**: anything that exists only in the re-simulation (what-if badge, path, caption, fork marker) |
| `--home` / `--away` | from match data | **identity**: a 4 px bar only, never a fill |

Rules: a plate never uses a signal colour as its fill; signal colours are bars, rules, ring/line strokes and single values.
At most one accent element per view. Pitch colours stay ≤ 1.0 so the bloom pass never catches graphics (no glow).

### Type
One family: **Onest** (SIL OFL 1.1, self-hosted in `src/fonts/`, latin + latin-ext). Three weights: 500 text, 700 labels/names/values,
800 score and full-screen titles only. Tabular figures everywhere (`font-variant-numeric: tabular-nums`).
Case: CAPS + 0.1 em tracking only for kickers, labels, team codes and player tags; sentence case for every line someone reads.

| token | at 1080p | use |
|---|---|---|
| `--fs-1` | 15 px | kickers, labels, units, chips |
| `--fs-2` | 20 px | tag/badge values, card head, agent names |
| `--fs-3` | 28 px | scorebug, stat values, subtitles |
| `--fs-4` | 40 px | lower-third line |
| `--fs-5` | 85 px | full-screen titles |

### Scale, spacing, shape
- `--u` = frame height / 216 (5 px at 1080p): every size is a multiple, so graphics scale with the frame like real broadcast output.
  `--k` scales a subtree (quad quadrants use 0.75).
- Spacing `--s1 … --s6` = 1, 2, 3, 4, 6 u. Radius `--radius` 2 px. Bars `--bar` 0.8 u (4 px).
- Safe areas: corner furniture (scorebug, stat card, lower thirds, badges) inside the 5 % graphics-safe inset (`--safe-x/y`);
  centred reading text (subtitles, full-screen cards) inside 10 % title-safe.

### Motion
- One easing: `cubic-bezier(0.25, 1, 0.5, 1)` = easeOutQuart (`ease()` in tokens.ts).
- Durations: fast 200 ms, base 400 ms, draw 800 ms.
- In: reveal from the anchor side (plates wipe out of their bar over *base*; pitch lines draw on along their length; rings draw on by angle).
  Out: fade only, *fast*, no movement. Nothing loops, blinks or pulses.
- Everything is computed from match time (no CSS transitions) so the recorder is frame-exact.

## Components (7 + pitch line family)

1. **Scorebug** `.sb`: `[bar CODE][score][CODE bar][clock]` on one plate; score on `--surface-2`, 800 weight; clock 500.
   A fresh goal draws an accent rule under the score for 5 s. Top-left, single/ghost views; hidden in split (the badges carry the score).
2. **Player tag** (canvas, `drawPlayerTag`): `[team bar][num][NAME]` + optional `| value unit` metric (value in accent) + 2 px leader to the head.
   The focus (selected player) adds an accent underline. Max 3 per view: carrier, selected, one sprinter.
3. **Lower third** `.lt`: `[signal bar][kicker / line]`. Bar = accent (director caption), whatif (what-if side), team colour (goal).
   Variant `.lt.sub` = AI commentary subtitle: no bar, kicker "AI commentary · language", 500-weight line, centred.
   Lower thirds stack in one zone bottom-left (right half for the what-if side in split), above the subtitle row. Max 2 stacked.
4. **Stat card** `.card`: head on `--surface-2` (title + team codes with team bars) + 2-4 rows `label | value | value`. Variant `.card.one`
   (one value column) is the player card, whose head is the player tag anatomy. Revealed top-down by the lens.
5. **Label badge** `.badge`: `[signal bar][KICKER][value]`, one line, caps. Used for: split/ghost view labels with score, the what-if strap,
   quad persona label, gallery title, the line-height label on the pitch (canvas `drawLabel`), Microsoft stack on the architecture card.
6. **Agent card** `.agent`: `[idx NAME state][role][chips]` on `--surface-2` with a 3 px top rule in its state colour
   (idle 40 % opacity, live = accent, done = rule, error/recovered = alert). Also the start-screen entry tiles and architecture nodes.
   Chips (newest two shown): tool calls (newest in `--text`), ✓ claims that aired, struck-through claims in alert.
7. **Full-screen card**: `--surface-solid`, kicker (`fs-2`, caps, text-2) + title (`fs-5`, 800) + line (`fs-3`, 500), left-aligned at title-safe.
   Interstitials, rewind, architecture, end card (`video/cards.*`) and the start screen.

**Pitch line family** (`graphics.ts`, `LINE` in tokens.ts): flat, anti-aliased, no halo, occluded by players.
- Widths are metres at the broadcast gantry and scale with camera distance (constant on-screen weight; player cam thinner, high cam thicker).
- Primary 0.30 m: back line, pass arrows, the what-if path. Shot = 1.5 × primary. Secondary 0.12 m: offside, shape hull/units, rings, pressure.
- Solid = something that is there (a line of players, a pass). Dashed = a reference or relation (offside line, hull, pressure links).
- White by default; colour only by meaning: alert = pressure/misplaced pass, accent = focus ring, whatif = alternate path.
- Labels on the pitch are badges anchored to the end of what they measure.

## Density per lens

| lens | on screen (max) |
|---|---|
| casual (< 0.35) | scorebug, carrier ring + tag, one speed tag, ≤ 2 lower thirds, subtitle |
| analysis (0.35–0.6) | + back line with height badge, pass arrows, pressure ring/links |
| tactical (> 0.6) | + offside line, defending team's shape, stat card; speed tags drop out |

No graphic without information; no overlaps (tags declutter by priority: selected > carrier > sprinter > line label); one accent element per view.
App chrome (control bar, help) is not on air: it uses the tokens but never appears in recorded frames.
