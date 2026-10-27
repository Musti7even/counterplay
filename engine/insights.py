#!/usr/bin/env python3
"""Deterministic "interpret" stage: match/fork JSON (FORMAT.md) -> <name>.insights.json.

  python insights.py ../data/match.json        # writes ../data/match.insights.json
  python insights.py --selftest

Pure stdlib + numpy (no GRF), so it runs in both the engine env (py3.9) and the MCP env.
All numbers are in match time (300 s per GRF match); formulas are deliberately small.
Event ids are "e<index into doc['events']>".
"""
import json, math, os, sys

import numpy as np

WIN = 10.0                 # team window, seconds
SPRINT = 7.0               # m/s, 1 s rolling speed; GRF top speed is ~7.7 m/s
TELEPORT = 12.0            # m/s per frame; above = restart reposition, not running
GOAL_W = 7.32
SIDES = ('home', 'away')


def other(side):
    return 'away' if side == 'home' else 'home'


def fwd(side):
    return 1 if side == 'home' else -1  # attacking direction in x


def fidx(doc, t):
    """Frame index for match time t (clamped)."""
    f = doc['frames']
    i = int(round((t - f[0]['t']) * doc['meta']['fps']))
    return max(0, min(i, len(f) - 1))


def dist(a, b):
    return float(math.hypot(a[0] - b[0], a[1] - b[1]))


def seg_dist(p, a, b):
    """Distance from point p to segment a-b."""
    a, b, p = np.asarray(a, float), np.asarray(b, float), np.asarray(p, float)
    ab = b - a
    u = 0.0 if not ab.any() else float(np.clip(np.dot(p - a, ab) / np.dot(ab, ab), 0, 1))
    return float(np.linalg.norm(p - (a + u * ab)))


def ball_speed_after(doc, t, secs=0.3):
    """Peak ball speed (m/s, xy) in the first `secs` after t: launch speed of a pass/shot."""
    fr, fps, i = doc['frames'], doc['meta']['fps'], fidx(doc, t)
    sp = [dist(fr[j + 1]['ball'], fr[j]['ball']) * fps for j in range(i, min(i + int(secs * fps) + 1, len(fr) - 1))
          if fr[j]['mode'] == fr[j + 1]['mode'] == 'play' and fr[j]['score'] == fr[j + 1]['score']]  # no restart jumps
    return max(sp) if sp else 0.0


# ---- per-event metrics -------------------------------------------------------------------

def pass_metrics(doc, e):
    f = doc['frames'][fidx(doc, e['t'])]
    team, opp = e['team'], other(e['team'])
    a, b = e['from'], e['to']
    d = dist(a, b)
    opps = f[opp][1:]  # outfield opponents at release
    in_lane = sum(seg_dist(p, a, b) < 3 for p in opps)
    press = min(dist(p, a) for p in opps)
    lo, hi = sorted((a[0], b[0]))
    bypassed = sum(lo < p[0] < hi for p in opps) if (b[0] - a[0]) * fwd(team) > 0 else 0
    # difficulty 0-100 = length (<=35) + opponents near lane (<=30) + pressure on passer (<=20)
    #                  + line-breaking (<=15, 5 per opponent bypassed in the attacking direction)
    diff = (35 * min(d / 40, 1) + min(12 * in_lane, 30) + 20 * max(0.0, (5 - press) / 5)
            + 5 * min(bypassed, 3))
    fr, i = doc['frames'], fidx(doc, e['t'])
    t_end = next((g['t'] for g in fr[i + 1:i + 100] if g['owner'] and (g['owner']['team'], g['owner']['idx']) != (team, e['idx'])),
                 fr[min(i + 1, len(fr) - 1)]['t'])  # when the pass arrived: first frame someone else owns it
    return {'distance': round(d, 1), 'speed': round(ball_speed_after(doc, e['t']), 1), 'tEnd': t_end,
            'opponentsInLane': in_lane, 'pressureDist': round(press, 1), 'bypassed': bypassed,
            'lineBreaking': bypassed >= 3, 'difficulty': int(round(diff))}


def shot_geometry(pos, gx):
    """Distance to goal centre and the angle (rad) the goal mouth subtends."""
    x, y = abs(gx - pos[0]), abs(pos[1])
    ang = math.atan2(GOAL_W * x, x * x + y * y - (GOAL_W / 2) ** 2)
    return math.hypot(x, y), ang if ang >= 0 else ang + math.pi


def xg(d, ang):
    # simple logistic on distance + angle (public "basic xG" shape): ~0.5 at 6 m central,
    # ~0.25 at the penalty spot, ~0.05 from 25 m
    return 1 / (1 + math.exp(-(-1.1 - 0.09 * d + 1.6 * ang)))


def shot_metrics(doc, e):
    d, ang = shot_geometry(e['from'], e['to'][0])
    return {'speedKmh': round(ball_speed_after(doc, e['t']) * 3.6, 1), 'distance': round(d, 1),
            'angleDeg': round(math.degrees(ang), 1), 'xg': round(xg(d, ang), 3)}


def event_metrics(doc):
    out = []
    for i, e in enumerate(doc['events']):
        m = {'id': f'e{i}', 'event': e}
        if e['type'] == 'pass':
            m.update(pass_metrics(doc, e))
        elif e['type'] == 'shot':
            m.update(shot_metrics(doc, e))
        out.append(m)
    return out


# ---- per-player -------------------------------------------------------------------------

def player_speeds(doc, side, idx):
    """Per-frame speed (m/s) with restart teleports zeroed, and its 1 s rolling mean."""
    fps = doc['meta']['fps']
    p = np.array([f[side][idx] for f in doc['frames']], float)
    v = np.r_[0.0, np.linalg.norm(np.diff(p, axis=0), axis=1) * fps]
    v[v > TELEPORT] = 0.0
    return v, np.convolve(v, np.ones(fps) / fps, 'full')[:len(v)]  # trailing window


def heart_rate(roll, fps):
    """SYNTHETIC heart rate (bpm) from load: 100 bpm jogging .. 185 bpm sprinting,
    first-order lag with 15 s time constant. Not physiology, just a plausible gauge."""
    target = 100 + 85 * np.clip((roll - 2) / 5.5, 0, 1)
    hr, a, out = 100.0, 1 - math.exp(-1 / (15 * fps)), np.empty(len(roll))
    for i, x in enumerate(target):
        hr += (x - hr) * a
        out[i] = hr
    return out


def player_stats(doc, side, idx, t0=None, t1=None):
    fps, fr = doc['meta']['fps'], doc['frames']
    i0, i1 = fidx(doc, fr[0]['t'] if t0 is None else t0), fidx(doc, fr[-1]['t'] if t1 is None else t1)
    v, roll = player_speeds(doc, side, idx)
    hr = heart_rate(roll, fps)
    v, roll, hr = v[i0:i1 + 1], roll[i0:i1 + 1], hr[i0:i1 + 1]
    above = roll >= SPRINT
    top = int(np.argmax(roll))
    p = doc['meta'][side]['players'][idx]
    return {'id': p['id'], 'name': p['name'], 'pos': p['pos'], 'team': side,
            't0': fr[i0]['t'], 't1': fr[i1]['t'],
            'distance': round(float(v.sum() / fps), 1),
            'topSpeed': round(float(roll[top]), 2), 'topSpeedKmh': round(float(roll[top]) * 3.6, 1),
            'topSpeedT': fr[i0 + top]['t'],
            'sprints': int(np.sum(above[1:] & ~above[:-1]) + above[0]),
            'avgHr': int(hr.mean()), 'maxHr': int(hr.max()), 'hrSynthetic': True,
            'series': {'t': [fr[i]['t'] for i in range(i0, i1 + 1, fps)],  # 1 Hz
                       'speed': [round(float(x), 2) for x in roll[::fps]],
                       'hr': [int(x) for x in hr[::fps]]}}


# ---- team windows -----------------------------------------------------------------------

def owners(frames):
    """Team in possession per frame, carrying the last owner through loose-ball frames."""
    cur, out = None, []
    for f in frames:
        if f['owner']:
            cur = f['owner']['team']
        out.append(cur)
    return out


def window_stats(doc, t0, t1):
    fr, fps = doc['frames'], doc['meta']['fps']
    i0, i1 = fidx(doc, t0), fidx(doc, t1)
    own = owners(fr)[i0:i1 + 1]
    seg = fr[i0:i1 + 1]
    res = {'t0': seg[0]['t'], 't1': seg[-1]['t'], 'score': seg[-1]['score']}
    known = [o for o in own if o] or [None]
    for s in SIDES:
        xs = np.array([f[s] for f in seg])[:, 1:]  # outfield players, frames x 10 x 2
        depth = (xs[:, :, 0] * fwd(s) + 52.5)       # metres from own goal line
        cen = xs.mean(axis=1, keepdims=True)
        press = [sum(dist(p, f['ball']) < 5 for p in f[s]) for f, o in zip(seg, own) if o == other(s)]
        res[s] = {
            'possession': round(100 * known.count(s) / len(known), 1),
            'lineHeight': round(float(np.sort(depth, axis=1)[:, :4].mean()), 1),  # 4 deepest outfielders
            'compactness': round(float(np.linalg.norm(xs - cen, axis=2).mean()), 1),  # mean dist to centroid, m
            'pressing': round(float(np.mean(press)) if press else 0.0, 2),  # players within 5 m of ball off the ball
        }
    turnovers = sum(1 for a, b in zip(own, own[1:]) if a and b and a != b)
    bs = [dist(b['ball'], a['ball']) * fps for a, b in zip(seg, seg[1:])
          if a['mode'] == b['mode'] == 'play' and a['score'] == b['score']]
    # chaos 0-100: half from turnovers (6+ per window = max), half from ball-speed std (8 m/s = max)
    chaos = 50 * min(turnovers / 6, 1) + 50 * min((float(np.std(bs)) if bs else 0) / 8, 1)
    # momentum -100..100 (+ = home): half possession balance, half mean ball territory
    mom = 0.5 * (res['home']['possession'] - res['away']['possession']) + \
        50 * float(np.mean([f['ball'][0] for f in seg])) / 52.5
    res.update({'turnovers': turnovers, 'control': int(round(100 - chaos)), 'chaos': int(round(chaos)),
                'momentum': int(round(mom))})
    return res


# ---- moments ----------------------------------------------------------------------------

def moments(doc, ev, wins, players):
    """Ranked story candidates; `score` is a rough newsworthiness number, evidence is raw."""
    c = []
    name = lambda s, i: doc['meta'][s]['players'][i]['name'] if i is not None else None
    for m in ev:
        e = m['event']
        if e['type'] == 'goal':
            sh = [x for x in ev if x['event']['type'] == 'shot' and x['event']['team'] == e['team']
                  and 0 <= e['t'] - x['event']['t'] <= 3]
            c.append({'type': 'goal', 't': e['t'], 'score': 100,
                      'title': f"Goal {doc['meta'][e['team']]['short']}: {name(e['team'], e['idx'])}",
                      'evidence': {'events': [m['id']] + [x['id'] for x in sh[-1:]],
                                   'xg': sh[-1]['xg'] if sh else None, 'scoreAfter': doc['frames'][fidx(doc, e['t'])]['score']}})
        elif e['type'] == 'shot' and m['xg'] >= 0.12:
            c.append({'type': 'big_chance', 't': e['t'], 'score': round(55 + 100 * m['xg']),
                      'title': f"Big chance: {name(e['team'], e['idx'])} ({m['speedKmh']} km/h, xG {m['xg']})",
                      'evidence': {'events': [m['id']], 'xg': m['xg'], 'distance': m['distance'], 'speedKmh': m['speedKmh']}})
        elif e['type'] == 'pass' and e['ok'] and (m['lineBreaking'] or m['difficulty'] >= 65):
            c.append({'type': 'line_breaking_pass', 't': e['t'], 'score': round(25 + 0.4 * m['difficulty'] + 3 * m['bypassed']),
                      'title': f"{name(e['team'], e['idx'])} breaks {m['bypassed']} opponents ({m['distance']} m)",
                      'evidence': {'events': [m['id']], 'difficulty': m['difficulty'], 'bypassed': m['bypassed'],
                                   'distance': m['distance']}})
    for s in SIDES:
        for w in wins:
            if w[s]['pressing'] >= 1.5:
                c.append({'type': 'pressing_spell', 't': w['t0'], 't1': w['t1'], 'score': round(20 + 15 * w[s]['pressing']),
                          'title': f"{doc['meta'][s]['short']} press: {w[s]['pressing']} players on the ball",
                          'evidence': {'team': s, 'pressing': w[s]['pressing'], 'window': [w['t0'], w['t1']]}})
    for a, b in zip(wins, wins[1:]):
        if abs(b['momentum'] - a['momentum']) >= 50:
            to = 'home' if b['momentum'] > a['momentum'] else 'away'
            c.append({'type': 'momentum_swing', 't': b['t0'], 't1': b['t1'], 'score': round(20 + abs(b['momentum'] - a['momentum']) / 3),
                      'title': f"Momentum swings to {doc['meta'][to]['short']} ({a['momentum']} -> {b['momentum']})",
                      'evidence': {'from': a['momentum'], 'to': b['momentum'], 'windows': [[a['t0'], a['t1']], [b['t0'], b['t1']]]}})
    for s in SIDES:  # fastest player per team
        p = max((x for x in players if x['team'] == s), key=lambda x: x['topSpeed'])
        c.append({'type': 'sprint_milestone', 't': p['topSpeedT'], 'score': 35,
                  'title': f"{p['name']} hits {p['topSpeedKmh']} km/h, fastest {doc['meta'][s]['short']} run",
                  'evidence': {'player': p['id'], 'topSpeedKmh': p['topSpeedKmh'], 'sprints': p['sprints']}})
    c.sort(key=lambda m: (-m['score'], m['t']))
    kept = []
    for m in c:  # one moment per 5 s, best first
        if all(abs(m['t'] - k['t']) >= 5 for k in kept):
            kept.append(m)
    for i, m in enumerate(kept):
        m['id'] = f'm{i + 1}'
    return kept


def analyze(doc):
    fr = doc['frames']
    ev = event_metrics(doc)
    players = [player_stats(doc, s, i) for s in SIDES for i in range(11)]
    t, wins = fr[0]['t'], []
    while t < fr[-1]['t']:
        wins.append(window_stats(doc, t, min(t + WIN, fr[-1]['t'])))
        t = round(t + WIN, 1)
    return {'meta': {'forkOf': doc['meta'].get('forkOf'), 'window': WIN, 'sprintThreshold': SPRINT,
                     'notes': 'heart rate is synthetic (derived from running load); xG is a distance+angle logistic'},
            'events': ev, 'players': players, 'windows': wins, 'moments': moments(doc, ev, wins, players)}


def divergence(base, fork):
    """What changed in a fork vs its base match: goals prevented/created, score, displacement."""
    t0 = fork['meta']['forkOf']['t']
    goals = lambda d: [(e['t'], e['team']) for e in d['events'] if e['type'] == 'goal' and e['t'] >= t0]
    bg, fg = goals(base), goals(fork)
    match = lambda g, gs: any(g[1] == h[1] and abs(g[0] - h[0]) <= 2 for h in gs)
    pid = fork['meta']['forkOf'].get('params', {}).get('player')
    side, idx = ('home' if pid and pid[0] == 'h' else 'away'), (int(pid[1:]) - 1 if pid else None)
    at = {}
    for dt in (1, 3, 5, 10):
        t = round(t0 + dt, 1)
        if t > fork['frames'][-1]['t'] or t > base['frames'][-1]['t']:
            break
        f, b = fork['frames'][fidx(fork, t)], base['frames'][fidx(base, t)]
        disp = sorted(((dist(f[s][i], b[s][i]), base['meta'][s]['players'][i]['id']) for s in SIDES for i in range(11)), reverse=True)
        at[f'+{dt}s'] = {'ball': round(dist(f['ball'], b['ball']), 1),
                         'tweakedPlayer': round(dist(f[side][idx], b[side][idx]), 1) if pid else None,
                         'mostDisplaced': [[p, round(d, 1)] for d, p in disp[:3]]}
    first = next((f['t'] for f in fork['frames'] if f['t'] > t0 and
                  dist(f['ball'], base['frames'][fidx(base, f['t'])]['ball']) > 1), None)
    end_t = fork['frames'][-1]['t']
    return {'forkOf': fork['meta']['forkOf'], 'ballDivergesAt': first,
            'goalsPrevented': [g for g in bg if g[0] <= end_t and not match(g, fg)],
            'goalsCreated': [g for g in fg if not match(g, bg)],
            'scoreBase': base['frames'][fidx(base, end_t)]['score'], 'scoreFork': fork['frames'][-1]['score'],
            'displacement': at}


def write(path):
    with open(path) as fh:
        doc = json.load(fh)
    out = os.path.splitext(path)[0] + '.insights.json'
    with open(out, 'w') as fh:
        json.dump(analyze(doc), fh, separators=(',', ':'), ensure_ascii=False)
    return out


def selftest():
    # synthetic 20 s: home h2 runs +x at 5 m/s, ball follows; one 30 m forward pass past 3 defenders
    meta = {'fps': 10, 'home': {'short': 'H', 'players': [{'id': f'h{i+1}', 'name': f'H{i}', 'pos': 'X'} for i in range(11)]},
            'away': {'short': 'A', 'players': [{'id': f'a{i+1}', 'name': f'A{i}', 'pos': 'X'} for i in range(11)]}}
    frames = []
    for k in range(201):
        home = [[-50.0, 0.0]] + [[-20.0 + 0.5 * k if i == 1 else -10.0, i * 2.0] for i in range(1, 11)]
        away = [[50.0, 0.0]] + [[5.0 + i, 20.0 - 4 * i] for i in range(1, 11)]
        frames.append({'t': k / 10, 'ball': home[1] + [0.1], 'home': home, 'away': away,
                       'owner': {'team': 'home', 'idx': 1}, 'mode': 'play', 'score': [0, 0]})
    ev = [{'t': 1.0, 'type': 'pass', 'team': 'home', 'idx': 1, 'toIdx': 2, 'from': [-15, 2], 'to': [15, 2], 'ok': True}]
    doc = {'meta': meta, 'frames': frames, 'events': ev}
    p = player_stats(doc, 'home', 1)
    assert abs(p['distance'] - 100) < 0.6 and abs(p['topSpeed'] - 5) < 1e-6, p['distance']
    assert p['sprints'] == 0 and p['hrSynthetic']
    m = pass_metrics(doc, ev[0])
    assert m['distance'] == 30 and m['bypassed'] >= 3 and m['lineBreaking'] and 0 <= m['difficulty'] <= 100, m
    assert xg(*shot_geometry([46.5, 0], 52.5)) > 0.4 > xg(*shot_geometry([30, 10], 52.5))
    w = window_stats(doc, 0, 10)
    assert w['home']['possession'] == 100 and w['turnovers'] == 0 and w['momentum'] > 0
    print('selftest ok')


if __name__ == '__main__':
    if sys.argv[1:] == ['--selftest']:
        selftest()
    else:
        for p in sys.argv[1:]:
            print(write(p))
