#!/usr/bin/env python3
"""Local speech-to-text with open-source Whisper (faster-whisper, CPU int8).

  python transcribe.py                       # pl-hackathon/voice/* -> data/commands/transcripts.json
  python transcribe.py a.mp3 b.wav --out x.json

One file per command (one utterance per file), or one file with pauses (each Whisper segment
becomes an utterance {file, start, end, text}). command.py uses these instead of the scripted lines.
"""
import argparse, glob, json, os

HERE = os.path.dirname(os.path.abspath(__file__))
CODE = os.path.dirname(HERE)
VOICE_DIR = os.path.join(os.path.dirname(CODE), 'voice')
OUT = os.path.join(CODE, 'data', 'commands', 'transcripts.json')
# domain vocabulary (squad + club names) so Whisper spells the fictional names right
PROMPT = 'Counterplay. Redmoor FC, Halvard Athletic, Moreau, Sørensen, what-if, commentary.'


def transcribe(files, model='small', lang='en'):
    from faster_whisper import WhisperModel
    m = WhisperModel(model, device='cpu', compute_type='int8')
    out = []
    for f in files:
        segs, _ = m.transcribe(f, language=lang, vad_filter=True, beam_size=5, initial_prompt=PROMPT)
        for s in segs:
            out.append({'file': os.path.basename(f), 'start': round(s.start, 2), 'end': round(s.end, 2), 'text': s.text.strip()})
    return out


if __name__ == '__main__':
    ap = argparse.ArgumentParser()
    ap.add_argument('files', nargs='*')
    ap.add_argument('--model', default='small', help='faster-whisper size: base | small')
    ap.add_argument('--lang', default='en')
    ap.add_argument('--out', default=OUT)
    a = ap.parse_args()
    files = a.files or sorted(f for f in glob.glob(os.path.join(VOICE_DIR, '*'))
                              if f.lower().endswith(('.wav', '.mp3', '.m4a', '.ogg', '.webm', '.aac', '.flac', '.mp4', '.mov')))
    if not files:
        raise SystemExit(f'no audio in {VOICE_DIR}')
    res = transcribe(files, a.model, a.lang)
    if len(files) > 1:  # one file per command: one utterance per file
        res = [{'file': f, 'start': us[0]['start'], 'end': us[-1]['end'], 'text': ' '.join(u['text'] for u in us)}
               for f in dict.fromkeys(u['file'] for u in res) for us in [[u for u in res if u['file'] == f]]]
    os.makedirs(os.path.dirname(a.out), exist_ok=True)
    json.dump({'model': f'faster-whisper {a.model}', 'utterances': res}, open(a.out, 'w'), ensure_ascii=False, indent=1)
    for u in res:
        print(f"{u['file']} {u['start']:6.2f}-{u['end']:6.2f}  {u['text']}")
