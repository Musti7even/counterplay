#!/usr/bin/env python3
"""Demo v4 cut: "Your match, on command" (story.md v4): voice-command pills drive the broadcast. Builds shots/demo-v2.mp4 from
shots/v2/*.mp4 clips, shots/v2/*.png frozen frames (scripts/stills.mjs) and shots/cards/v2-*.png overlays.
Holds are single frames held by ffmpeg; captions/chapter bar are composited here. Silent.
  python3 scripts/assemble-v2.py [--out demo-v2.mp4] [--fill-v1]   (--fill-v1: use demo-v1 clips for missing chapters)
"""
import json, os, subprocess, sys, tempfile

WEB = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SH, V2, CARDS = f'{WEB}/shots', f'{WEB}/shots/v2', f'{WEB}/shots/cards'
OUT = sys.argv[sys.argv.index('--out') + 1] if '--out' in sys.argv else 'demo-v4.mp4'
FILL = '--fill-v1' in sys.argv
FPS, FADE = 30, 0.3
TMP = tempfile.mkdtemp(prefix='pl-v2-')
ENC = ['-r', str(FPS), '-pix_fmt', 'yuv420p', '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-an', '-video_track_timescale', '30000']
n = 0

def ff(*a): subprocess.run(['ffmpeg', '-loglevel', 'error', '-y', *a], check=True)
def dur(f): return float(subprocess.check_output(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', f]).decode())
def card(name):
    for pre in ('v4', 'v3', 'v2'):
        if os.path.exists(f'{CARDS}/{pre}-{name}.png'): return f'{CARDS}/{pre}-{name}.png'
    raise FileNotFoundError(name)
def have(f):  # a clip counts only once the recorder finished it (sidecar written last)
    return os.path.exists(f) and (not f.endswith('.mp4') or os.path.exists(f[:-4] + '.frames.json'))

def seg(base_inputs, base_filter, length, overlays=(), bar=None):
    """base_inputs: ffmpeg input args producing [0..k]; base_filter: filter graph ending in [base] (1920x1080@30, `length` s).
    overlays: (png, start, end) faded in/out over FADE s. bar: chapter number for the persistent chapter bar."""
    global n
    n += 1
    out = f'{TMP}/{n:02d}.mp4'
    ins, fil, k0 = list(base_inputs), [base_filter], sum(1 for x in base_inputs if x == '-i')
    ovs = list(overlays) + ([(card(f'bar{bar}'), 0, length)] if bar else [])
    last = 'base'
    for j, ov in enumerate(ovs):
        png, a, b = ov[:3]
        ins += (['-i', png] if png.endswith('.mov') else ['-loop', '1', '-t', f'{length:.3f}', '-i', png])
        idx = k0 + j
        if png.endswith('.mov'):  # pre-timed rgba track (typing pill): plain overlay
            fil.append(f'[{idx}:v]format=rgba[o{j}];[{last}][o{j}]overlay=0:0:format=auto:eof_action=pass[v{j}]')
        else:
            fi = '' if a <= 0 else f',fade=in:st={a:.3f}:d={FADE}:alpha=1'
            fo = '' if b >= length else f',fade=out:st={b - FADE:.3f}:d={FADE}:alpha=1'
            fil.append(f'[{idx}:v]format=rgba{fi}{fo}[o{j}];[{last}][o{j}]overlay=0:0:format=auto[v{j}]')
        last = f'v{j}'
    # one set of colour tags for every segment: mixed tags make ffmpeg reconfigure mid-stream and xfade stops early
    fil.append(f'[{last}]fps={FPS},scale=out_range=tv,format=yuv420p,setparams=range=tv:colorspace=bt709:color_primaries=bt709:color_trc=bt709[out]')
    ff(*ins, '-filter_complex', ';'.join(fil), '-map', '[out]', '-t', f'{length:.3f}', *ENC, out)
    return out

def still(png, length, overlays=(), bar=None, zoom=0.0):
    z = f",zoompan=z='1+{zoom}*on/{int(length * FPS)}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d={int(length * FPS)}:s=1920x1080:fps={FPS}" if zoom else ''
    pre = 'scale=3840:2160' if zoom else 'scale=1920:1080'
    return seg(['-loop', '1', '-t', f'{length:.3f}', '-i', png], f'[0:v]{pre}{z},setsar=1,fps={FPS}[base]', length, overlays, bar)

def xfade_still(a_png, b_png, hold_a, trans, hold_b, kind='fade', overlays=(), bar=None):
    """A held, then transition to B (fade = lens ramp; wiperight = path draws on), B held."""
    L = hold_a + trans + hold_b
    return seg(['-loop', '1', '-t', f'{hold_a + trans:.3f}', '-i', a_png, '-loop', '1', '-t', f'{trans + hold_b:.3f}', '-i', b_png],
               f'[0:v]scale=1920:1080,setsar=1,fps={FPS}[a];[1:v]scale=1920:1080,setsar=1,fps={FPS}[b];'
               f'[a][b]xfade=transition={kind}:duration={trans}:offset={hold_a}[base]', L, overlays, bar)

def clip(mp4, overlays=(), bar=None, start=0.0, length=None, hold_end=0.0):
    L = (length if length is not None else dur(mp4) - start)
    tot = L + hold_end
    pad = f',tpad=stop_mode=clone:stop_duration={hold_end}' if hold_end else ''
    return seg(['-ss', f'{start:.3f}', '-t', f'{L:.3f}', '-i', mp4], f'[0:v]scale=1920:1080,setsar=1,fps={FPS}{pad}[base]', tot, overlays, bar)

def quad_layout(mp4, start, length, layout, spot=None, hold_end=0.0, overlays=(), bar=None):
    """layout 2: top-left + top-right quadrants side by side (letterboxed); 4: full quad. spot: quadrant index lit (others dimmed)."""
    pad = f',tpad=stop_mode=clone:stop_duration={hold_end}' if hold_end else ''
    if layout == 2:
        f = (f'[0:v]scale=1920:1080,setsar=1,fps={FPS}{pad},split[q1][q2];[q1]crop=960:540:0:0[a];[q2]crop=960:540:960:0[b];'
             f'[a][b]hstack,pad=1920:1080:0:270:color=0x140a22[base0]')
        boxes = {0: (0, 270), 1: (960, 270)}
    else:
        f = f'[0:v]scale=1920:1080,setsar=1,fps={FPS}{pad}[base0]'
        boxes = {0: (0, 0), 1: (960, 0), 2: (0, 540), 3: (960, 540)}
    if spot is not None:
        dims = ''.join(f',drawbox=x={x}:y={y}:w=960:h=540:color=black@0.62:t=fill' for i, (x, y) in boxes.items() if i != spot)
        sx, sy = boxes[spot]
        f += f';[base0]null{dims},drawbox=x={sx}:y={sy}:w=960:h=540:color=0x38ff8b:t=4[base]'
    else:
        f += ';[base0]null[base]'
    return seg(['-ss', f'{start:.3f}', '-t', f'{length:.3f}', '-i', mp4], f, length + hold_end, overlays, bar)

def wipe_join(parts, out):
    """Chapters joined by one transition style: the design-system wipe (left sweep, 0.4 s)."""
    W = 0.4
    if len(parts) == 1: return ff('-i', parts[0], '-c', 'copy', out)
    ins, fil, acc, last = [], [], dur(parts[0]), 's0'
    for i, p in enumerate(parts):
        ins += ['-i', p]
        fil.append(f'[{i}:v]settb=AVTB,setpts=PTS-STARTPTS,fps={FPS},format=yuv420p,setsar=1[s{i}]')  # same clock for every input
    for i in range(1, len(parts)):
        off = acc - W
        fil.append(f'[{last}][s{i}]xfade=transition=wipeleft:duration={W}:offset={off:.3f}[x{i}]')
        last = f'x{i}'; acc = off + dur(parts[i])
    ff(*ins, '-filter_complex', ';'.join(fil), '-map', f'[{last}]', *ENC, '-movflags', '+faststart', out)

# ---------------------------------------------------------------- the cut
s = lambda name: f'{V2}/{name}.png'
v = lambda name: f'{V2}/{name}.mp4'
V4 = f'{SH}/v4'
DATA = os.path.join(os.path.dirname(WEB), 'data')
VOICE = os.path.join(os.path.dirname(os.path.dirname(WEB)), 'voice')
M = json.load(open(f'{CARDS}/v4-manifest.json'))

# optional user voice recordings (pl-hackathon/voice/): files sorted, the n-th file = story line n (1-9).
# No command voice track is generated; without recordings the pills type at a fixed pace and stay silent.
vfiles = sorted(f for f in os.listdir(VOICE) if f.lower().endswith(('.m4a', '.mp3', '.wav', '.aac', '.ogg', '.flac'))) if os.path.isdir(VOICE) else []
def user_voice(n): return os.path.join(VOICE, vfiles[n - 1]) if len(vfiles) >= n else None
AMB = os.environ.get('AMB_DIR', os.path.join(DATA, 'audio', 'ambience'))
goals = []   # absolute timeline times of on-screen goal frames (ball crosses the line) -> crowd roar
def goal_at(mp4, start_in_clip=0.0, match_t=69.5):
    side = mp4[:-4] + '.frames.json'
    if not os.path.exists(side): return None
    ts = json.load(open(side))['ts']; fi = next((k for k, x in enumerate(ts) if x >= match_t - 1e-6), None)
    return None if fi is None else fi / FPS - start_in_clip

segments, audio = [], []   # audio: (file, absolute start s, volume)
T = 0.0
def add(seg_file, events=()):
    global T
    for f, at, vol in events: audio.append((f, T + at, vol))
    segments.append(seg_file); T += dur(seg_file)

def pill(n, at, length):
    """Command n typed in word by word from `at` (pace = the user's recording if present), stays until the segment ends;
    tool chip follows. Returns (overlays, audio events)."""
    c = M['cmds'][n - 1]; words = c['words']; uv = user_voice(n)
    typing = min(dur(uv), length - at - 1.0) if uv else max(1.4, 0.26 * words)
    # one rgba track per pill (word frames with durations), so a segment has one overlay input, not one per word
    blank = f'{TMP}/blank.png'
    if not os.path.exists(blank): ff('-f', 'lavfi', '-i', 'color=c=black@0.0:s=1920x1080,format=rgba', '-frames:v', '1', blank)
    lst = f'{TMP}/pill{n}-{at:.2f}.txt'
    with open(lst, 'w') as fh:
        fh.write(f"file '{blank}'\nduration {at:.3f}\n")
        for k in range(words):
            fh.write(f"file '{CARDS}/{c['pill']}-{k + 1}.png'\nduration {(typing / words if k < words - 1 else max(0.1, length - at - typing * (words - 1) / words)):.3f}\n")
        fh.write(f"file '{CARDS}/{c['pill']}-{words}.png'\n")
    track = f'{TMP}/pill{n}-{at:.2f}-{length:.2f}.mov'
    ff('-f', 'concat', '-safe', '0', '-i', lst, '-vf', f'fps={FPS},format=rgba', '-c:v', 'qtrle', '-t', f'{length:.3f}', track)
    ov = [(track, 0, length), (f"{CARDS}/{c['chip']}", at + typing + 0.3, length)]
    return ov, ([(uv, at, 1.0)] if uv else [])

def commentary(key, clip_mp4, clip_start, seg_start_in_clip, length):
    """Subtitles (+ voice if data/audio/<run>/voice.json exists) for commentary lines whose match time falls inside the
    visible window of a recorded clip. Match time -> clip time via the recorder's frames.json sidecar."""
    side = clip_mp4[:-4] + '.frames.json'
    ts = json.load(open(side))['ts'] if os.path.exists(side) else None
    run = M['runs'][key]; vj = os.path.join(DATA, 'audio', run, 'voice.json')
    voices = {round(l['t'], 2): os.path.join(DATA, 'audio', run, l['file']) for l in json.load(open(vj))} if os.path.exists(vj) else {}
    ov, ev = [], []
    for l in M['subs'][key]:
        if ts is None: continue
        fi = next((k for k, x in enumerate(ts) if x >= l['t'] - 1e-6), None)
        if fi is None: continue
        at = fi / FPS - clip_start - seg_start_in_clip
        if at < -0.5 or at > length - 1.0: continue
        at = max(0.0, at)
        vf = voices.get(round(l['t'], 2))
        d = dur(vf) if vf and os.path.exists(vf) else max(2.5, 0.075 * len(l['text']))
        ov.append((f"{CARDS}/{l['png']}", at, min(length, at + d + 0.5)))
        if vf and os.path.exists(vf): ev.append((vf, at, 1.0))
    return ov, ev

def lastframe(mp4, at_s, name):
    f = f'{TMP}/{name}.png'; ff('-ss', f'{at_s:.3f}', '-i', mp4, '-frames:v', '1', f); return f

ch1 = v('ch1')   # clean broadcast 63.0 -> 71.2 (real speed); stops at 7.9 s (70.95) before the kick-off wipe

# 1 "We're watching a match live..." : clean broadcast, Moreau scores, hold
o, e = pill(1, 0.4, 9.4)
goals.append(T + goal_at(ch1))
add(clip(ch1, o, length=7.9, hold_end=1.5), e)

# 2 "Show me that goal from four angles." : typed over the held goal frame, then the 2x2 angles (shots/v4/angles4.mp4)
goal_frame = lastframe(ch1, 7.85, 'goalframe')
o, e = pill(2, 0.2, 2.8)
add(still(goal_frame, 2.8, o), e)
ang = f'{V4}/angles4.mp4'
c2 = M['cmds'][1]
keep = [(f"{CARDS}/{c2['pill']}-{c2['words']}.png", 0, 99), (f"{CARDS}/{c2['chip']}", 0, 99)]
if have(ang):
    g = goal_at(ang)
    if g is not None: goals.append(T + g)
    add(clip(ang, [(p, a, min(b, 2.4)) for p, a, b in keep], hold_end=2.5))
else:
    add(clip(f'{V2}/quad.mp4', [(p, a, min(b, 2.4)) for p, a, b in keep], length=3.9, hold_end=2.5))

# 3 "My uncle says it's Sørensen's fault..." : Sørensen highlighted, SIMULATING (real fork_what_if chip), path, play, split result
o, e = pill(3, 0.2, 7.2)
o.append((card('sim'), 4.6, 7.2))
add(still(s('s3a'), 7.2, o), e)
add(xfade_still(s('s3a'), s('s3b'), 0.0, 1.8, 2.6, 'wiperight', [(f'{CARDS}/v2-c3b.png', 0.5, 4.4)]))
add(clip(v('ch3'), length=3.2))
goals.append(T + 0.05)  # split opens on the original's goal (69.6, ball in the net)
add(clip(v('ch3split'), [(f'{CARDS}/v2-c3c.png', 0.6, 5.3)], length=1.3, hold_end=4.0))  # 1–0 becomes 0–0

# 4-6 commentary voices on the same goal moment: simple English, second language, German
def voice_seg(n, key, start_in_clip, length, typing_at=0.3):
    o, e = pill(n, typing_at, length)
    so, se = commentary(key, ch1, 0.0, start_in_clip, length)
    clip_len = min(7.9 - start_in_clip, length)
    g = goal_at(ch1, start_in_clip)
    if g is not None and 0 <= g < length: goals.append(T + g)
    add(clip(ch1, o + so, start=start_in_clip, length=clip_len, hold_end=max(0.0, length - clip_len)), e + se)
voice_seg(4, 'simple', 2.0, 10.0)
voice_seg(5, 'lang2', 2.8, 8.0)
voice_seg(6, 'lang3', 2.8, 10.0)  # German goal call runs ~5.5 s

# 7 "When I watch alone, I want the full tactics." : tactical lens, back line, km/h, engine heart rate*, highlighted players,
#   expert voice (shots/v4/tactical.mp4: ?lens=0.7&gfx=line,lineTag,flare,owner,shot,pass&sel=home:7&hrcard=1&nol3=1&speed=0.5, 66-70.95)
tac = f'{V4}/tactical.mp4'
if have(tac):
    o, e = pill(7, 0.3, 3.2)
    first = lastframe(tac, 0.0, 'tacfirst')
    add(still(first, 3.2, o), e)
    c7 = M['cmds'][6]
    keep7 = [(f"{CARDS}/{c7['pill']}-{c7['words']}.png", 0, 2.0), (f"{CARDS}/{c7['chip']}", 0, 2.0)]
    # the expert goal call is long (~14 s): play the clip, then hold its last frame with a slow push-in until the line ends
    so, se = commentary('expert', tac, 0.0, 0.0, 60.0)
    g = goal_at(tac); dA = dur(tac)
    if g is not None: goals.append(T + g)
    endsub = max([b for _, _, b in so] + [dA + 3.0])
    add(clip(tac, keep7 + [(p, a, max(b, dA + 1)) for p, a, b in so]), se)
    lenB = max(3.0, endsub - dA + 0.4)
    add(still(lastframe(tac, dA - 0.05, 'taclast'), lenB, [(p, 0, b - dA) for p, a, b in so if b > dA], zoom=0.03))
else:
    o, e = pill(7, 0.3, 12.0); add(clip(v('ch2'), o, hold_end=4.8), e)

# narrator: six agents (gallery, one agent lit at a time)
gal = [('intro', 3.0), ('analyst', 2.6), ('whatif', 2.8), ('fact', 3.2)]  # narrator line is ~6.4 s; keeps the cut under 1:55
nar = user_voice(8)
for i, (k, d) in enumerate(gal):
    add(still(s(f's5-{k}'), d, [(card(f'c5{k}'), 0, d)]), [(nar, 0.2, 1.0)] if (nar and i == 0) else [])

# end: "Counterplay. Your match, on command."
end_v = user_voice(9)
END_AT = T
add(still(card('end'), 6.5, zoom=0.02), [(end_v, 0.6, 1.0)] if end_v else [])

# join (hard cuts: the pills are the structure)
lst = f'{TMP}/all.txt'
with open(lst, 'w') as fh: fh.writelines(f"file '{p}'\n" for p in segments)
video = f'{TMP}/video.mp4'
ff('-f', 'concat', '-safe', '0', '-i', lst, '-c', 'copy', video)

# mix: voices over a crowd bed (looped, -26 dB, sidechain-ducked under voice) + goal roars, bed fades out under the end card;
# master loudness-normalised (two-pass) to -14 LUFS / -1.6 dBTP (margin for AAC overshoot)
crowd, roar = os.path.join(AMB, 'crowd_loop.mp3'), os.path.join(AMB, 'goal_roar.mp3')
ins, fil, vo, bed = [], [], [], []
def inp(f, loop=False):
    ins.extend((['-stream_loop', '-1'] if loop else []) + ['-i', f]); return sum(1 for x in ins if x == '-i')
for f, at, vol in audio:
    k = inp(f); fil.append(f'[{k}:a]aresample=48000,aformat=channel_layouts=stereo,volume={vol},adelay={int(at * 1000)}:all=1[v{k}]'); vo.append(f'[v{k}]')
if os.path.exists(crowd):
    k = inp(crowd, loop=True)
    fil.append(f'[{k}:a]aresample=48000,aformat=channel_layouts=stereo,atrim=0:{T:.3f},asetpts=PTS-STARTPTS,volume=-26dB,'  # loop peaks ~-0.2 dBFS
               f'afade=in:st=0:d=1.5,afade=out:st={END_AT:.3f}:d=2.5[b{k}]'); bed.append(f'[b{k}]')
if os.path.exists(roar):
    for g in goals:
        k = inp(roar); fil.append(f'[{k}:a]aresample=48000,aformat=channel_layouts=stereo,volume=-10dB,adelay={int(max(0, g - 0.1) * 1000)}:all=1[b{k}]'); bed.append(f'[b{k}]')
mixes = []
if vo:
    fil.append(''.join(vo) + f'amix=inputs={len(vo)}:normalize=0:duration=longest,apad=whole_dur={T:.3f}' + (',asplit=2[vox][sc]' if bed else '[vox]'))
if bed:
    fil.append(''.join(bed) + f'amix=inputs={len(bed)}:normalize=0:duration=longest,apad=whole_dur={T:.3f}[bedraw]')
    fil.append('[bedraw][sc]sidechaincompress=threshold=0.03:ratio=4:attack=60:release=500:makeup=1[bedd]' if vo else '[bedraw]anull[bedd]')
    mixes.append('[bedd]')
if vo: mixes.append('[vox]')
out = f'{SH}/{OUT}'
if mixes:
    fil.append(''.join(mixes) + f'amix=inputs={len(mixes)}:normalize=0:duration=longest,atrim=0:{T:.3f},loudnorm=I=-14:TP=-1:LRA=11,aresample=48000[a]')
    ff('-i', video, *ins, '-filter_complex', ';'.join(fil), '-map', '0:v', '-map', '[a]', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k',
       '-t', f'{T:.3f}', '-movflags', '+faststart', out)
    # second loudnorm pass (measured, linear) so the master really lands on -14 LUFS
    meas = subprocess.run(['ffmpeg', '-hide_banner', '-i', out, '-af', 'loudnorm=I=-14:TP=-1.6:LRA=11:print_format=json', '-f', 'null', '-'],
                          capture_output=True, text=True).stderr
    j = json.loads(meas[meas.rindex('{'):meas.rindex('}') + 1])
    tmp2 = out.replace('.mp4', '.norm.mp4')
    ff('-i', out, '-af', f"loudnorm=I=-14:TP=-1.6:LRA=11:measured_I={j['input_i']}:measured_TP={j['input_tp']}:measured_LRA={j['input_lra']}:"
       f"measured_thresh={j['input_thresh']}:offset={j['target_offset']}:linear=true,aresample=48000", '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k',
       '-movflags', '+faststart', tmp2)
    os.replace(tmp2, out)
else:
    ff('-i', video, '-c', 'copy', '-movflags', '+faststart', out)
print('goal roars at: ' + ', '.join(f'{g:.2f}' for g in goals))
print(f'{OUT}: {dur(out):.2f} s, {len(segments)} segments, voice events: {len(audio)} (user voice files: {len(vfiles)}), ambience: {os.path.exists(crowd)}/{os.path.exists(roar)}')
