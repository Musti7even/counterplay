# Third-party assets

The visual assets here are CC0 1.0 (public domain dedication). No attribution is required; it is listed for provenance.
The audio (below) has its own terms.

| file | source | licence |
|---|---|---|
| `players/mannequin.glb` | Quaternius, **Universal Animation Library** (Standard, free). The glTF is mirrored at https://github.com/J-Ponzo/gltf-universal-animation-library (the original is at https://quaternius.itch.io/universal-animation-library). Pruned to the Idle / Walk / Jog / Sprint and a few other clips with gltf-transform. | CC0 1.0 |
| `textures/grass/{color,normal,roughness,ao}.jpg` | ambientCG, **Grass 005** (1K JPG), https://ambientcg.com/view?id=Grass005 | CC0 1.0 |
| `hdri/kloppenheim_02_puresky_1k.hdr` | Poly Haven, **Kloppenheim 02 (Pure Sky)**, https://polyhaven.com/a/kloppenheim_02_puresky | CC0 1.0 |

The following are generated in code, not downloaded: the ball texture, crowd sprites, line markings, net, LED boards and noise.

## Voices and sound: ElevenLabs (elevenlabs.io)

The following audio in `data/audio/` is generated with ElevenLabs:
- **Goal commentary** (`match.*.goal/`): `eleven_multilingual_v2` with premade voices Charlie (simple EN), Daniel (expert EN), Liam (ES) and Adam (DE).
- **Voiced viewer commands** (`commands/`): the premade voice Chris.
- **Stadium ambience** (`ambience/crowd_loop.mp3`, `ambience/goal_roar.mp3`): the sound-generation endpoint.

These were made on the free plan, which requires attribution: **Voices and sound: ElevenLabs (elevenlabs.io)**.

## Offline fallback voices and speech models

Without an ElevenLabs or Azure key, `agents/voice.py` synthesises locally with [Piper](https://github.com/OHF-Voice/piper1-gpl) (`piper-tts`, GPL-3.0). It is used as a tool and is not distributed here. The voices come from [rhasspy/piper-voices](https://huggingface.co/rhasspy/piper-voices).

Every voice was checked against its MODEL_CARD and only licences that allow commercial use are used: no NC and no share-alike.

| use | voice | dataset (MODEL_CARD) | licence |
|---|---|---|---|
| English, simple | `en_US-bryce-medium` | the author's own recordings (https://brycebeattie.com/files/tts/) | public domain |
| English, expert | `en_US-mike-medium` | OHF-Voice voice-datasets | CC0 |
| German | `de_DE-thorsten-high` | Thorsten-Voice | CC0 |
| Spanish | `es_MX-claude-high` | HirCoir Piper-TTS-Spanish | Apache-2.0 |

Caveat: mike and thorsten are fine-tuned from Piper's `en_US-lessac` base voice, whose Blizzard 2013 source data has its own terms.

Voice commands are transcribed locally with [faster-whisper](https://github.com/SYSTRAN/faster-whisper) (MIT) using OpenAI Whisper `small` weights (MIT).
