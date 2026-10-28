#!/usr/bin/env python3
"""Commentary voice for a crew run, plus the voiced viewer commands.

  python voice.py ../data/match.casual.en.goal.commentary.json [...]   [--engine elevenlabs|azure-speech|piper]
    -> data/audio/<run>/<n>.mp3 + data/audio/<run>/voice.json [{t, file, dur, text, spoken, engine, voice}]
       (file is relative to the run dir, as web/src/overlay.ts and web/scripts/mux-voice.mjs expect)
  python voice.py --commands   -> data/audio/commands/<n>.mp3 + voice.json (the story's command lines)
  python voice.py --ambience   -> data/audio/ambience/{crowd_loop,goal_roar}.mp3 (ElevenLabs sound generation)

Engine: ElevenLabs if ELEVENLABS_API_KEY is set (env or code/.env), else Azure AI Speech if AZURE_SPEECH_KEY/REGION,
else local open-source Piper voices. ElevenLabs results are cached on disk by request hash (.tools/el-cache), so a
re-run never spends credits again. Run with the TTS env (.tools/ttsenv: piper-tts, faster-whisper).
"""
import hashlib, json, os, re, shutil, subprocess, sys, tempfile, urllib.request, wave
from xml.sax.saxutils import escape

HERE = os.path.dirname(os.path.abspath(__file__))
CODE = os.path.dirname(HERE)
DATA = os.path.join(CODE, 'data')
TOOLS = os.path.normpath(os.path.join(CODE, '..', '.tools'))
PIPER_DIR = os.environ.get('PIPER_VOICES', os.path.join(TOOLS, 'piper'))

# ElevenLabs (free plan: credits = characters; attribution "Voices and sound: ElevenLabs (elevenlabs.io)")
EL_MODEL = 'eleven_multilingual_v2'
EL_VOICES = {('en', 'casual'): ('IKne3meq5aSn9XLyUdCD', 'Charlie'), ('en', 'analyst'): ('onwK4e9ZLuTAKqWW03F9', 'Daniel'),
             ('en', 'player'): ('onwK4e9ZLuTAKqWW03F9', 'Daniel'), ('es', None): ('TX3LPaxmHKxFdv7VOQHJ', 'Liam'),
             ('de', None): ('pNInz6obpgDQGcFmaJgB', 'Adam'), ('viewer', None): ('iP95p4xoKVk53GoZ742B', 'Chris')}
EL_STYLE = {'excited': dict(stability=0.3, style=0.75, speed=1.08), 'calm': dict(stability=0.45, style=0.45, speed=1.1)}
EL_CACHE = os.path.join(TOOLS, 'el-cache')

# Azure AI Speech
AZURE = {'en': ('en-GB', 'en-GB-RyanNeural'), 'es': ('es-ES', 'es-ES-AlvaroNeural'),
         'tr': ('tr-TR', 'tr-TR-AhmetNeural'), 'de': ('de-DE', 'de-DE-ConradNeural')}

# Piper offline fallback: only CC0 / public-domain / Apache-2.0 voices (commercial use OK, no NC, no share-alike)
PIPER = {('en', 'casual'): 'en_US-bryce-medium', ('en', 'analyst'): 'en_US-mike-medium', ('en', 'player'): 'en_US-mike-medium',
         ('de', None): 'de_DE-thorsten-high', ('es', None): 'es_MX-claude-high'}
PACE = {'en_US-bryce-medium': 0.88, 'de_DE-thorsten-high': 0.92}  # per-voice speed trim (multiplies length_scale)
# style -> (length_scale: <1 is faster, pitch factor, extra gain dB)
FEEL = {'excited': (0.78, 1.07, 3), 'cheerful': (0.84, 1.04, 2), 'hopeful': (0.88, 1.02, 1),
        'newscast': (0.9, 1.0, 0), 'calm': (0.88, 1.0, 0)}
# Piper-only respellings so the synthetic voices say the fictional names right (captions keep the real spelling).
# Picked by synthesising candidates and checking them with Whisper. ElevenLabs/Azure need none.
RESPELL = {
    'en': [('Moreau', 'Mo-roh'), ('Halvard', 'Hal-vard'), ('Redmoor', 'Red-moor'), ('Sørensen', 'Sorensen'), (' FC', ' F C')],
    'de': [('Moreau', 'Moroh'), ('Halvard', 'Hallward'), ('Redmoor', 'Redd-Moor'), ('Sørensen', 'Sörensen'), (' FC', ' F C'),
           ('Athletic', 'Äthletik')],
    'es': [('Moreau', 'Moró'), ('Halvard', 'Jálvard'), ('Redmoor', 'Red-mur'), ('Sørensen', 'Sórensen'), (' FC', ' efe ce'),
           ('Athletic', 'Átletic')],
}
NUM = {'en': ['nil', 'one', 'two', 'three', 'four', 'five'], 'de': ['null', 'eins', 'zwei', 'drei', 'vier', 'fünf'],
       'tr': ['sıfır', 'bir', 'iki', 'üç', 'dört', 'beş'], 'es': ['cero', 'uno', 'dos', 'tres', 'cuatro', 'cinco']}
SAY = {'en': {'km/h': 'kilometres per hour', 'xG': 'expected goals'}, 'de': {'km/h': 'Kilometer pro Stunde', 'xG': 'Expected Goals'},
       'tr': {'km/sa': 'kilometre', 'km/h': 'kilometre', 'xG': 'gol beklentisi'}, 'es': {'km/h': 'kilómetros por hora', 'xG': 'goles esperados'}}
SCORE = {'en': '{a} {b}', 'de': '{a} zu {b}', 'tr': '{a} {b}', 'es': '{a} a {b}'}


def load_env():
    path = os.path.join(CODE, '.env')
    if os.path.exists(path):
        for line in open(path):
            k, _, v = line.strip().partition('=')
            if k and not k.startswith('#') and v:
                os.environ.setdefault(k, v.strip().strip('"\''))


def spoken(text, lang, respell=True):
    """Caption text -> what the voice says: surnames without initials, units/abbreviations and
    scores in words, shouty caps toned down. Adds no facts."""
    t = re.sub(r'\b[A-ZÄÖÜÇŞİ]\.\s+', '', text)
    for a, b in (RESPELL.get(lang, []) if respell else []):
        t = t.replace(a, b)
    t = re.sub(r'\bG+O+A*L+\b|\bGO+L\b|\bTO+R\b', lambda m: {'en': 'Goal', 'de': 'Tor', 'tr': 'Gol', 'es': 'Gol'}[lang], t)
    for k, v in SAY.get(lang, {}).items():
        t = t.replace(k, v)
    n = NUM.get(lang, NUM['en'])
    t = re.sub(r'\b([0-5])-([0-5])\b', lambda m: SCORE.get(lang, '{a} {b}').format(a=n[int(m[1])] if not (lang == 'en' and m[1] == '0') else 'nil', b=n[int(m[2])]), t)
    return re.sub(r'([.!?] )([a-z])', lambda m: m[1] + m[2].upper(), t)


def run_info(path):
    base = os.path.basename(path).replace('.commentary.json', '')
    parts = base.split('.')  # <match>.<persona>.<lang>[.<tag>]
    return base, parts[1].split('-')[0], parts[2]


def el_post(path, body, out):
    """POST to ElevenLabs once; cache by request hash so re-runs cost nothing."""
    os.makedirs(EL_CACHE, exist_ok=True)
    key = hashlib.sha256(json.dumps([path, body], sort_keys=True).encode()).hexdigest()[:24]
    cached = os.path.join(EL_CACHE, key + '.mp3')
    if not os.path.exists(cached):
        req = urllib.request.Request('https://api.elevenlabs.io' + path, data=json.dumps(body).encode(), method='POST',
                                     headers={'xi-api-key': os.environ['ELEVENLABS_API_KEY'], 'Content-Type': 'application/json'})
        with urllib.request.urlopen(req, timeout=120) as r:
            data = r.read()
        open(cached, 'wb').write(data)
    shutil.copyfile(cached, out)


def el_line(text, lang, persona, style, out_mp3):
    vid, name = EL_VOICES.get((lang, persona)) or EL_VOICES.get((lang, None)) or EL_VOICES[('en', 'casual')]
    st = EL_STYLE['excited' if style in ('excited', 'cheerful') else 'calm']
    body = {'text': text, 'model_id': EL_MODEL, 'voice_settings': dict(similarity_boost=0.8, use_speaker_boost=True, **st)}
    el_post(f'/v1/text-to-speech/{vid}?output_format=mp3_44100_128', body, out_mp3)
    return f'elevenlabs:{name}'


def azure_line(text, lang, persona, style, out_mp3):
    import azure.cognitiveservices.speech as sdk
    loc, voice = AZURE.get(lang, AZURE['en'])
    cfg = sdk.SpeechConfig(subscription=os.environ['AZURE_SPEECH_KEY'], region=os.environ['AZURE_SPEECH_REGION'])
    cfg.set_speech_synthesis_output_format(sdk.SpeechSynthesisOutputFormat.Audio24Khz96KBitRateMonoMp3)
    ssml = (f'<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xmlns:mstts="https://www.w3.org/2001/mstts" '
            f'xml:lang="{loc}"><voice name="{voice}"><mstts:express-as style="{style}"><prosody rate="+12%">{escape(text)}'
            f'</prosody></mstts:express-as></voice></speak>')
    r = sdk.SpeechSynthesizer(speech_config=cfg, audio_config=None).speak_ssml_async(ssml).get()
    if r.reason != sdk.ResultReason.SynthesizingAudioCompleted:
        raise RuntimeError(f'azure tts failed: {r.cancellation_details.error_details}')
    open(out_mp3, 'wb').write(r.audio_data)
    return voice


_voices = {}


def piper_line(text, lang, persona, style, out_mp3):
    from piper import PiperVoice, SynthesisConfig
    name = PIPER.get((lang, persona)) or PIPER.get((lang, None)) or PIPER[('en', 'casual')]
    if name not in _voices:
        _voices[name] = PiperVoice.load(os.path.join(PIPER_DIR, name + '.onnx'))
    ls, pitch, gain = FEEL.get(style, FEEL['calm'])
    ls *= PACE.get(name, 1.0)
    with tempfile.NamedTemporaryFile(suffix='.wav') as tmp:
        with wave.open(tmp.name, 'wb') as w:
            _voices[name].synthesize_wav(text, w, syn_config=SynthesisConfig(length_scale=ls, noise_scale=0.75, noise_w_scale=0.9))
        sr = 22050
        af = (f'asetrate={int(sr * pitch)},aresample={sr},atempo={1 / pitch:.4f},'  # pitch up, same pace
              f'highpass=f=90,acompressor=threshold=-20dB:ratio=3:attack=5:release=80,volume={gain}dB,apad=pad_dur=0.15')
        subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-i', tmp.name, '-af', af, '-ac', '1', '-ar', '44100',
                        '-c:a', 'libmp3lame', '-b:a', '96k', out_mp3], check=True)
    return name


ENGINES = {'elevenlabs': el_line, 'azure-speech': azure_line, 'piper': piper_line}


def pick_engine(forced=None):
    load_env()
    if forced:
        return forced
    if os.environ.get('ELEVENLABS_API_KEY'):
        return 'elevenlabs'
    return 'azure-speech' if os.environ.get('AZURE_SPEECH_KEY') and os.environ.get('AZURE_SPEECH_REGION') else 'piper'


def duration(path):
    out = subprocess.run(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', path],
                         capture_output=True, text=True, check=True).stdout
    return round(float(out), 2)


def main(path, engine):
    base, persona, lang = run_info(path)
    out_dir = os.path.join(DATA, 'audio', base)
    os.makedirs(out_dir, exist_ok=True)
    manifest = []
    for i, l in enumerate(json.load(open(path))):
        f = f'{i:03d}.mp3'
        say = spoken(l['text'], lang, respell=engine == 'piper')
        voice = ENGINES[engine](say, lang, persona, l.get('voice_style', 'calm'), os.path.join(out_dir, f))
        manifest.append({'t': l['t'], 'file': f, 'dur': duration(os.path.join(out_dir, f)), 'text': l['text'], 'spoken': say,
                         'engine': engine, 'voice': voice})
    for m, nxt in zip(manifest, manifest[1:]):  # never talk over the next line: tighten locally (no re-synthesis)
        room = nxt['t'] - m['t'] - 0.2
        if m['dur'] > room:
            f = os.path.join(out_dir, m['file'])
            tempo = min(m['dur'] / room, 1.25)
            subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-i', f, '-af', f'atempo={tempo:.3f}', '-c:a', 'libmp3lame',
                            '-b:a', '128k', f + '.tmp.mp3'], check=True)
            os.replace(f + '.tmp.mp3', f)
            m['dur'], m['tempo'] = duration(f), round(tempo, 3)
    json.dump(manifest, open(os.path.join(out_dir, 'voice.json'), 'w'), ensure_ascii=False, indent=1)
    print(f"{base}: {len(manifest)} lines via {engine}; spans {[(m['t'], round(m['t'] + m['dur'], 2)) for m in manifest]}")


def commands():
    """Voice the story's command lines (no user recording yet) with one casual 'viewer at home' voice (ElevenLabs)."""
    out_dir = os.path.join(DATA, 'audio', 'commands')
    os.makedirs(out_dir, exist_ok=True)
    vid, name = EL_VOICES[('viewer', None)]
    manifest = []
    for n, text in enumerate(json.load(open(os.path.join(DATA, 'commands', 'story.json'))), 1):
        f = f'{n}.mp3'
        body = {'text': text, 'model_id': EL_MODEL,
                'voice_settings': dict(stability=0.5, similarity_boost=0.8, style=0.3, use_speaker_boost=True, speed=1.0)}
        el_post(f'/v1/text-to-speech/{vid}?output_format=mp3_44100_128', body, os.path.join(out_dir, f))
        manifest.append({'n': n, 'file': f, 'dur': duration(os.path.join(out_dir, f)), 'text': text,
                         'engine': 'elevenlabs', 'voice': f'elevenlabs:{name}'})
    json.dump(manifest, open(os.path.join(out_dir, 'voice.json'), 'w'), ensure_ascii=False, indent=1)
    print(f'commands: {len(manifest)} lines, {sum(m["dur"] for m in manifest):.1f} s')


AMBIENCE = [  # ElevenLabs sound-generation (<= 3,000 credits budget)
    ('crowd_loop.mp3', {'text': 'Seamless loop of a huge football stadium crowd at a night match: deep continuous murmur of 50,000 fans, '
                                'distant rhythmic clapping and wordless chanting swells, whistles, no music, no intelligible words',
                        'duration_seconds': 20, 'prompt_influence': 0.5, 'loop': True}),
    ('goal_roar.mp3', {'text': 'Football stadium crowd erupts as a goal is scored: sudden massive roar of 50,000 fans, cheering and '
                               'screaming, then sustained celebration, no music, no intelligible words',
                       'duration_seconds': 5, 'prompt_influence': 0.5}),
]


def ambience():
    out = os.path.join(DATA, 'audio', 'ambience')
    os.makedirs(out, exist_ok=True)
    for f, body in AMBIENCE:
        el_post('/v1/sound-generation?output_format=mp3_44100_128', body, os.path.join(out, f))
        print(f, duration(os.path.join(out, f)), 's')


if __name__ == '__main__':
    args = sys.argv[1:]
    forced = args[args.index('--engine') + 1] if '--engine' in args else None
    files = [a for a in args if a.endswith('.json')]
    if '--commands' in args:
        commands()
    if '--ambience' in args:
        ambience()
    engine = pick_engine(forced)
    for p in files:
        main(p, engine)
