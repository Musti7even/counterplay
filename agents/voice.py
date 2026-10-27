#!/usr/bin/env python3
"""Azure AI Speech TTS for crew commentary.

  python voice.py ../data/match.casual.en.commentary.json
    -> data/audio/match.casual.en/<n>.mp3 + data/audio/match.casual.en/voice.json [{t, file, dur, text}]

Needs AZURE_SPEECH_KEY + AZURE_SPEECH_REGION (env or code/.env); without them it says so and exits 0.
voice_style maps to SSML <mstts:express-as>; voices that lack a style just read it neutrally.
"""
import json, os, sys
from xml.sax.saxutils import escape

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(os.path.dirname(HERE), 'data')
VOICES = {'en': ('en-US', 'en-US-GuyNeural'), 'es': ('es-ES', 'es-ES-AlvaroNeural'),
          'tr': ('tr-TR', 'tr-TR-AhmetNeural'), 'de': ('de-DE', 'de-DE-ConradNeural')}


def ssml(text, lang, style):
    loc, voice = VOICES.get(lang, VOICES['en'])
    return (f'<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" '
            f'xmlns:mstts="https://www.w3.org/2001/mstts" xml:lang="{loc}"><voice name="{voice}">'
            f'<mstts:express-as style="{style}">{escape(text)}</mstts:express-as></voice></speak>')


def main(path):
    sys.path.insert(0, HERE)
    from crew import load_env
    load_env()
    key, region = os.environ.get('AZURE_SPEECH_KEY'), os.environ.get('AZURE_SPEECH_REGION')
    if not (key and region):
        print('voice: AZURE_SPEECH_KEY / AZURE_SPEECH_REGION not set, skipping TTS')
        return
    import azure.cognitiveservices.speech as sdk
    base = os.path.basename(path).replace('.commentary.json', '')
    lang = base.split('.')[-1]
    cfg = sdk.SpeechConfig(subscription=key, region=region)
    cfg.set_speech_synthesis_output_format(sdk.SpeechSynthesisOutputFormat.Audio24Khz96KBitRateMonoMp3)
    synth = sdk.SpeechSynthesizer(speech_config=cfg, audio_config=None)
    out_dir = os.path.join(DATA, 'audio', base)
    os.makedirs(out_dir, exist_ok=True)
    with open(path) as fh:
        lines = json.load(fh)
    manifest = []
    for i, l in enumerate(lines):
        r = synth.speak_ssml_async(ssml(l['text'], lang, l.get('voice_style', 'calm'))).get()
        if r.reason != sdk.ResultReason.SynthesizingAudioCompleted:
            print(f"voice: line {i} failed: {r.cancellation_details.reason} {r.cancellation_details.error_details}")
            continue
        f = f'{i:03d}.mp3'
        with open(os.path.join(out_dir, f), 'wb') as fh:
            fh.write(r.audio_data)
        manifest.append({'t': l['t'], 'file': f'audio/{base}/{f}', 'dur': round(r.audio_duration.total_seconds(), 2), 'text': l['text']})
    with open(os.path.join(out_dir, 'voice.json'), 'w') as fh:
        json.dump(manifest, fh, ensure_ascii=False, indent=1)
    print(f'voice: {len(manifest)}/{len(lines)} lines -> {out_dir}')


if __name__ == '__main__':
    for p in sys.argv[1:]:
        main(p)
