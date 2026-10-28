#!/usr/bin/env python3
"""Demo v2 cut: one moment told five ways (video.md). Builds shots/demo-v2.mp4 from
shots/v2/*.mp4 clips, shots/v2/*.png frozen frames (scripts/stills.mjs) and shots/cards/v2-*.png overlays.
Holds are single frames held by ffmpeg; captions/chapter bar are composited here. Silent.
  python3 scripts/assemble-v2.py [--out demo-v2.mp4] [--fill-v1]   (--fill-v1: use demo-v1 clips for missing chapters)
"""
import json, os, subprocess, sys, tempfile

WEB = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SH, V2, CARDS = f'{WEB}/shots', f'{WEB}/shots/v2', f'{WEB}/shots/cards'
OUT = sys.argv[sys.argv.index('--out') + 1] if '--out' in sys.argv else 'demo-v2.mp4'
FILL = '--fill-v1' in sys.argv
FPS, FADE = 30, 0.3
TMP = tempfile.mkdtemp(prefix='pl-v2-')
ENC = ['-r', str(FPS), '-pix_fmt', 'yuv420p', '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-an', '-video_track_timescale', '30000']
n = 0

def ff(*a): subprocess.run(['ffmpeg', '-loglevel', 'error', '-y', *a], check=True)
def dur(f): return float(subprocess.check_output(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', f]).decode())
def card(name): return f'{CARDS}/v2-{name}.png'
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

# hook: blurred stadium, two lines
bg = f'{TMP}/hookbg.png'
src = v('ch1') if have(v('ch1')) else f'{SH}/coldopen.mp4'
ff('-i', src, '-frames:v', '1', '-vf', 'scale=1920:1080,boxblur=18:2,eq=brightness=-0.12', bg)
ch['hook'] = [still(bg, 6.0, [(card('hook1'), 0, 2.9), (card('hook2'), 2.9, 6.0)])]

# 1 what happened: real speed, goal + hold
# clips stop at match 70.95, before the kick-off wipe (goal hold ends 71.2); the last frame (ball in net, banner) is held
if have(v('ch1')): ch[1] = [clip(v('ch1'), bar=1, length=7.9, hold_end=2.0)]
elif FILL: ch[1] = [clip(f'{SH}/coldopen.mp4', bar=1)]

# 2 why: rewind -> freeze -> lens ramp -> graphics one by one -> play 0.5x to the shot
if all(have(s(x)) for x in ('s2a', 's2b', 's2c', 's2d')):
    p = [still(s('s2a'), 1.6, [(card('rewind'), 0, 1.6)], bar=2),
         xfade_still(s('s2a'), s('s2b'), 0.2, 1.4, 3.4, 'fade', [(card('c2a'), 1.2, 5.0)], bar=2),
         still(s('s2c'), 3.5, [(card('c2b'), 0, 3.5)], bar=2),
         still(s('s2d'), 3.7, [(card('c2c'), 0, 3.7)], bar=2)]
    if have(v('ch2')): p.append(clip(v('ch2'), bar=2))
    ch[2] = p
elif FILL: ch[2] = [clip(f'{SH}/lens.mp4', bar=2)]

# 3 what if: freeze on Sørensen -> question -> path draws -> play -> split result held
if have(s('s3a')) and have(s('s3b')):
    p = [still(s('s3a'), 3.4, [(card('c3a'), 0.2, 3.4)], bar=3),
         xfade_still(s('s3a'), s('s3b'), 0.0, 1.8, 2.8, 'wiperight', [(card('c3b'), 0.6, 4.6)], bar=3)]
    if have(v('ch3')): p.append(clip(v('ch3'), bar=3, length=3.2))  # stop before the ghosts crowd the frame
    if have(v('ch3split')): p.append(clip(v('ch3split'), [(card('c3c'), 0.8, 4.6)], bar=3, length=1.3, hold_end=3.5))
    ch[3] = p
elif FILL: ch[3] = [clip(f'{SH}/whatif.mp4', bar=3)]

# 4 every fan: 1 -> 2 -> 4, a short spotlight per newly added quadrant
if have(v('quad')) and have(v('ch1')):
    q, qd = v('quad'), min(dur(v('quad')), 3.9)  # 3.9 s = match 70.95, before the wipe
    p = [clip(v('ch1'), [(card('c4'), 0.2, 2.0), (card('c4a'), 2.0, 4.0)], bar=4, start=4.3, length=2.0, hold_end=2.0),
         quad_layout(q, 0.0, 1.0, 2, spot=1, hold_end=1.6, overlays=[(card('c4b'), 0.2, 2.6)], bar=4),
         quad_layout(q, 1.0, max(0.5, qd - 1.0 - 0.05), 4, spot=2, overlays=[(card('c4c'), 0.2, qd - 1.05)], bar=4),
         quad_layout(q, qd - 0.05, 0.04, 4, spot=3, hold_end=2.2, overlays=[(card('c4d'), 0.1, 2.24)], bar=4),
         quad_layout(q, qd - 0.05, 0.04, 4, spot=None, hold_end=2.0, overlays=[(card('c4'), 0.1, 2.04)], bar=4)]
    ch[4] = p
elif FILL: ch[4] = [clip(f'{SH}/quad.mp4', bar=4)]

# 5 how: one agent lit at a time, kill -> recovered held, fact-check
order = [('intro', 3.0), ('analyst', 2.8), ('tfail', 2.8), ('trec', 3.6), ('whatif', 2.8), ('fact', 3.6), ('producer', 2.6), ('local', 2.6)]
if all(have(s(f's5-{k}')) for k, _ in order):
    ch[5] = [still(s(f's5-{k}'), d, [(card(f'c5{k}'), 0, d)], bar=5) for k, d in order]
elif FILL: ch[5] = [clip(f'{SH}/control.mp4', bar=5)]

ch['arch'] = [still(f'{CARDS}/arch.png', 10.0, zoom=0.04)]
ch['end'] = [still(f'{CARDS}/end.png', 6.0, zoom=0.02)]

# inside a chapter: hard cuts; between chapters: the wipe
chap_files, t, rows = [], 0.0, []
for key in ['hook', 1, 2, 3, 4, 5, 'arch', 'end']:
    if key not in ch: rows.append(f'   --    {key}: MISSING'); continue
    lst = f'{TMP}/ch-{key}.txt'
    with open(lst, 'w') as fh: fh.writelines(f"file '{p}'\n" for p in ch[key])
    cf = f'{TMP}/ch-{key}.mp4'
    ff('-f', 'concat', '-safe', '0', '-i', lst, '-c', 'copy', cf)
    d = dur(cf); rows.append(f'{t:6.2f}  +{d:5.2f}  {key}'); t += d - 0.4
    chap_files.append(cf)
wipe_join(chap_files, f'{SH}/{OUT}')
print('\n'.join(rows))
print(f'{OUT}: {dur(f"{SH}/{OUT}"):.2f} s')
