# Match file format (engine → web)

One JSON file per match or fork: `data/<name>.json`.

```jsonc
{
  "meta": {
    "fps": 10,                       // frames per second of match time
    "pitch": { "length": 105, "width": 68 },
    "home": { "name": "Redmoor FC", "short": "RED", "color": "#d7263d", "players": [{ "id": "h1", "num": 1, "name": "A. Name", "pos": "GK" } /* ×11 */] },
    "away": { "name": "...", "short": "...", "color": "#...", "players": [/* ×11 */] },
    "forkOf": null                   // or { "match": "<name>", "t": 63.2, "tweak": "..." }
  },
  "frames": [
    {
      "t": 0.0,                      // seconds of match time
      "ball": [x, y, z],             // metres
      "home": [[x, y], /* ×11, same order as meta.home.players */],
      "away": [[x, y], /* ×11 */],
      "owner": { "team": "home", "idx": 9 },   // or null
      "mode": "play",                // play | kickoff | goalkick | freekick | corner | throwin | penalty
      "score": [0, 0]
    }
  ],
  "events": [
    { "t": 12.3, "type": "pass", "team": "home", "idx": 4, "toIdx": 9, "from": [x, y], "to": [x, y], "ok": true }
    // types: pass | shot | goal | tackle | interception | possession | foul | out
  ]
}
```

Coordinates: metres, origin at centre spot. `x` ∈ [-52.5, 52.5], home attacks +x. `y` ∈ [-34, 34], +y = left touchline seen from the home bench camera. `z` up.
GRF → this: `x_m = x_grf * 52.5`, `y_m = -y_grf * (34 / 0.42)`.
