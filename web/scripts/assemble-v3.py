#!/usr/bin/env python3
"""Demo v3 cut: "Settle the argument" (story.md), re-edited from the v2 footage (no 3D re-render). Builds shots/demo-v2.mp4 from
shots/v2/*.mp4 clips, shots/v2/*.png frozen frames (scripts/stills.mjs) and shots/cards/v2-*.png overlays.
Holds are single frames held by ffmpeg; captions/chapter bar are composited here. Silent.
  python3 scripts/assemble-v2.py [--out demo-v2.mp4] [--fill-v1]   (--fill-v1: use demo-v1 clips for missing chapters)
"""
import json, os, subprocess, sys, tempfile

WEB = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SH, V2, CARDS = f'{WEB}/shots', f'{WEB}/shots/v2', f'{WEB}/shots/cards'
OUT = sys.argv[sys.argv.index('--out') + 1] if '--out' in sys.argv else 'demo-v3.mp4'
FILL = '--fill-v1' in sys.argv
FPS, FADE = 30, 0.3
TMP = tempfile.mkdtemp(prefix='pl-v2-')
ENC = ['-r', str(FPS), '-pix_fmt', 'yuv420p', '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-an', '-video_track_timescale', '30000']
n = 0

def ff(*a): subprocess.run(['ffmpeg', '-loglevel', 'error', '-y', *a], check=True)
def dur(f): return float(subprocess.check_output(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', f]).decode())
def card(name): return f'{CARDS}/v3-{name}.png' if os.path.exists(f'{CARDS}/v3-{name}.png') else f'{CARDS}/v2-{name}.png'
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
    for j, (png, a, b) in enumerate(ovs):
        ins += ['-loop', '1', '-t', f'{length:.3f}', '-i', png]
        idx = k0 + j
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
ch = {}
s = lambda name: f'{V2}/{name}.png'
v = lambda name: f'{V2}/{name}.mp4'

# cold open: black -> blurred stadium, the line every fan has shouted
bg = f'{TMP}/hookbg.png'
ff('-i', v('ch1'), '-frames:v', '1', '-vf', 'scale=1920:1080,boxblur=18:2,eq=brightness=-0.12', bg)
ch['hook'] = [seg(['-loop', '1', '-t', '7', '-i', bg], f'[0:v]scale=1920:1080,setsar=1,fps={FPS},fade=in:st=0.6:d=1.2[base]', 7.0,
                  [(card('hook1'), 0.8, 3.6), (card('hook2'), 3.8, 7.0)])]

# 1 the goal (VO: Halvard, 69th minute, Deniz in Istanbul ... "Sørensen, step up!" ... too late)
ch[1] = [clip(v('ch1'), bar=1, length=7.9, hold_end=2.2)]

# 2 the argument: Tom's view, one graphic at a time, then the play
ch[2] = [still(s('s2a'), 1.6, [(card('rewind'), 0, 1.6)], bar=2),
         xfade_still(s('s2a'), s('s2b'), 0.2, 1.4, 3.2, 'fade', [(card('c2a'), 0.6, 4.8)], bar=2),
         still(s('s2c'), 3.3, [(card('c2b'), 0, 3.3)], bar=2),
         still(s('s2d'), 3.2, [(card('c2c'), 0, 3.2)], bar=2),
         clip(v('ch2'), [(card('c2d'), 2.4, 7.2)], bar=2)]

# 3 the answer
ch[3] = [still(s('s3a'), 3.0, [(card('c3a'), 0.2, 3.0)], bar=3),
         xfade_still(s('s3a'), s('s3b'), 0.0, 1.8, 2.8, 'wiperight', [(card('c3b'), 0.4, 4.6)], bar=3),
         clip(v('ch3'), bar=3, length=3.2),
         clip(v('ch3split'), [(card('c3c'), 0.8, 4.9)], bar=3, length=1.3, hold_end=3.6)]

# 4 every fan: quad persona labels repainted over the baked ones, then 1 -> 2 -> 4 with spotlights
q = f'{TMP}/quad-v3.mp4'
ff('-i', v('quad'), '-loop', '1', '-i', card('qlabels'), '-filter_complex', '[0:v][1:v]overlay=0:0:shortest=1[o]', '-map', '[o]', *ENC, q)
qd = min(dur(q), 3.9)  # 3.9 s = match 70.95, before the kick-off wipe
ch[4] = [clip(v('ch1'), [(card('c4'), 0.2, 2.0), (card('c4a'), 2.0, 3.6)], bar=4, start=4.3, length=2.0, hold_end=1.6),
         quad_layout(q, 0.0, 1.0, 2, spot=1, hold_end=1.6, overlays=[(card('c4b'), 0.2, 2.6)], bar=4),
         quad_layout(q, 1.0, max(0.5, qd - 1.0 - 0.05), 4, spot=2, overlays=[(card('c4c'), 0.2, qd - 1.05)], bar=4),
         quad_layout(q, qd - 0.05, 0.04, 4, spot=3, hold_end=2.6, overlays=[(card('c4d'), 0.1, 2.64)], bar=4),
         quad_layout(q, qd - 0.05, 0.04, 4, spot=None, hold_end=1.6, overlays=[(card('c4'), 0.1, 1.64)], bar=4)]

# 5 how: one agent at a time (trace order: the Tactician fails second), VO needs ~24 s
order = [('intro', 3.4), ('analyst', 3.0), ('tfail', 2.6), ('trec', 3.4), ('whatif', 2.8), ('fact', 3.6), ('producer', 2.6), ('local', 2.8)]
ch[5] = [still(s(f's5-{k}'), d, [(card(f'c5{k}'), 0, d)], bar=5) for k, d in order]

ch['arch'] = [still(f'{CARDS}/arch.png', 10.0, zoom=0.04)]
ch['end'] = [still(card('end'), 6.0, zoom=0.02)]

chap_files, t, rows = [], 0.0, []
for key in ['hook', 1, 2, 3, 4, 5, 'arch', 'end']:
    lst = f'{TMP}/ch-{key}.txt'
    with open(lst, 'w') as fh: fh.writelines(f"file '{p}'\n" for p in ch[key])
    cf = f'{TMP}/ch-{key}.mp4'
    ff('-f', 'concat', '-safe', '0', '-i', lst, '-c', 'copy', cf)
    d = dur(cf); rows.append(f'{t:6.2f}  +{d:5.2f}  {key}'); t += d - 0.4
    chap_files.append(cf)
wipe_join(chap_files, f'{SH}/{OUT}')
print('\n'.join(rows))
print(f'{OUT}: {dur(f"{SH}/{OUT}"):.2f} s')
