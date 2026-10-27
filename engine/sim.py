#!/usr/bin/env python3
"""Google Research Football match engine + "what if" forks. Output: ../data/FORMAT.md.

  python sim.py --seed 42 --steps 3000 --out ../data/match.json
  python sim.py --fork ../data/match.json --at 62 --tweak step_up --player a5 --out ../data/fork.json

All 22 players are external "agents" that send builtin_ai every step, so the base
match is pure GRF AI; a fork swaps the action of one player for a few seconds.
GRF is deterministic for a fixed game_engine_random_seed, and get_state/set_state
round-trips exactly, so base and fork differ only because of the tweak.
"""
import argparse, json, os, pickle, sys, types

import numpy as np
import gfootball_engine as libgame
from gfootball.env import config as cfg, football_env_core, football_action_set as A

FPS = 10
CKPT_EVERY = 50  # steps; ~117 KB per checkpoint
SX, SY = 52.5, -34 / 0.42  # GRF -> metres (FORMAT.md)
MODES = ['play', 'kickoff', 'goalkick', 'freekick', 'corner', 'throwin', 'penalty']
SIDES = ('home', 'away')  # home = GRF left team, attacks +x (GRF never swaps sides)

R = libgame.e_PlayerRole
# GRF 11_vs_11_stochastic formation; same for both teams, index = player idx.
FORM = [(-1.0, 0.0, R.e_PlayerRole_GK, 'GK', 1), (0.0, 0.02, R.e_PlayerRole_RM, 'RM', 7),
        (0.0, -0.02, R.e_PlayerRole_CF, 'CF', 9), (-0.422, -0.19576, R.e_PlayerRole_LB, 'LB', 3),
        (-0.5, -0.06356, R.e_PlayerRole_CB, 'CB', 4), (-0.5, 0.063559, R.e_PlayerRole_CB, 'CB', 5),
        (-0.422, 0.19576, R.e_PlayerRole_RB, 'RB', 2), (-0.184212, -0.10568, R.e_PlayerRole_CM, 'CM', 6),
        (-0.267574, 0.0, R.e_PlayerRole_CM, 'CM', 8), (-0.184212, 0.10568, R.e_PlayerRole_CM, 'CM', 10),
        (-0.01, -0.2161, R.e_PlayerRole_LM, 'LM', 11)]

CLUBS = {
    'home': ('Redmoor FC', 'RED', '#d7263d',
             ['T. Okonkwo', 'L. Varga', 'M. Ferreira', 'J. Lindqvist', 'K. Adeyemi', 'S. Novak',
              'R. Takahashi', 'D. Moreau', 'E. Castellanos', 'A. Brennan', 'Y. Haddad']),
    'away': ('Halvard Athletic', 'HAL', '#1b6ca8',
             ['P. Kowalczyk', 'N. Mensah', 'O. Aaltonen', 'B. Rinaldi', 'G. Duarte', 'H. Sørensen',
              'I. Petrescu', 'C. Achterberg', 'F. Delacroix', 'V. Ibarra', 'Z. Mbeki']),
}


def _scenario(steps):
    def build_scenario(b):
        c = b.config()
        c.game_duration = steps
        c.left_team_difficulty = c.right_team_difficulty = 0.8  # even match
        c.deterministic = False  # still reproducible: seeded by game_engine_random_seed
        for team in (libgame.e_Team.e_Left, libgame.e_Team.e_Right):
            b.SetTeam(team)
            for x, y, role, _, _ in FORM:
                b.AddPlayer(x, y, role)
    m = types.ModuleType('gfootball.scenarios.pl_match')
    m.build_scenario = build_scenario
    sys.modules[m.__name__] = m  # scenario_builder imports gfootball.scenarios.<level>


def make_env(seed, steps):
    _scenario(steps)
    env = football_env_core.FootballEnvCore(cfg.Config({
        'level': 'pl_match', 'action_set': 'full', 'game_engine_random_seed': seed,
        'players': ['agent:left_players=11,right_players=11']}))
    env.reset()
    return env


AI = [A.action_builtin_ai] * 22


def to_frame(step, o):
    own = None
    if o['ball_owned_team'] in (0, 1):
        own = {'team': SIDES[o['ball_owned_team']], 'idx': int(o['ball_owned_player'])}
    xy = lambda p: [round(float(p[0]) * SX, 2), round(float(p[1]) * SY, 2)]
    b = o['ball']
    return {'t': round(step / FPS, 1), 'ball': xy(b) + [round(float(b[2]), 2)],
            'home': [xy(p) for p in o['left_team']], 'away': [xy(p) for p in o['right_team']],
            'owner': own, 'mode': MODES[o['game_mode']], 'score': list(map(int, o['score']))}


def meta(seed, steps, fork_of=None):
    m = {'fps': FPS, 'pitch': {'length': 105, 'width': 68}, 'forkOf': fork_of,
         'engine': {'name': 'gfootball 2.10.2', 'seed': seed, 'steps': steps}}
    for side, p in (('home', 'h'), ('away', 'a')):
        name, short, color, names = CLUBS[side]
        m[side] = {'name': name, 'short': short, 'color': color, 'players': [
            {'id': f'{p}{i + 1}', 'num': f[4], 'name': names[i], 'pos': f[3]} for i, f in enumerate(FORM)]}
    return m


def dist(a, b):
    return float(np.hypot(a[0] - b[0], a[1] - b[1]))


def speed(frames, i):
    """Ball velocity (m/s, xy) from frame i to i+1."""
    return (np.array(frames[i + 1]['ball'][:2]) - frames[i]['ball'][:2]) * FPS


def detect_events(frames):
    """Events derived purely from frames (simple heuristics, good enough for a timeline):
    - shot: the ball is kicked (speed jumps to >= 18 m/s, from < 70% of that; one per 0.5 s) within 35 m
      of a goal, on a line crossing that goal line within 10 m of the centre, and an
      attacker is within 3 m of the ball. Kinematic, because GRF does not register
      ball ownership for first-time shots.
    - owner change within a team -> pass ok; to the other team -> tackle if the new owner
      was within 2 m of the old owner and the ball was loose <= 0.2 s, else failed pass +
      interception. After a shot or a stoppage the change is just 'possession'.
    - score change -> goal (credited to the last shooter of that team, else last owner).
    - play -> throwin/corner/goalkick = out; play -> freekick/penalty = foul.
    """
    ev, last, shot, shooter, shot_i = [], None, False, {}, -99  # last = (team, idx, frame index)
    for i, f in enumerate(frames):
        p = frames[i - 1] if i else f
        if f['score'] != p['score']:
            team = 'home' if f['score'][0] > p['score'][0] else 'away'
            ev.append({'t': f['t'], 'type': 'goal', 'team': team,
                       'idx': shooter.get(team, last[1] if last and last[0] == team else None)})
            shooter = {}
        if p['mode'] == 'play' and f['mode'] != 'play' and f['score'] == p['score']:
            ev.append({'t': f['t'], 'type': 'foul' if f['mode'] in ('freekick', 'penalty') else 'out',
                       'pos': f['ball'][:2]})
        if 0 < i < len(frames) - 1 and frames[i + 1]['score'] == f['score'] and i - shot_i > 5:
            v, v0, b0 = speed(frames, i), speed(frames, i - 1), np.array(f['ball'][:2])
            gx = 52.5 if v[0] > 0 else -52.5
            team = 'home' if gx > 0 else 'away'
            if (np.hypot(*v) >= 18 and np.hypot(*v0) < 0.7 * np.hypot(*v) and dist(b0, (gx, 0)) < 35
                    and abs(b0[1] + v[1] * (gx - b0[0]) / v[0]) < 10):
                idx = min(range(11), key=lambda j: dist(f[team][j], b0))
                if dist(f[team][idx], b0) < 3:
                    y = b0[1] + v[1] * (gx - b0[0]) / v[0]
                    ev.append({'t': f['t'], 'type': 'shot', 'team': team, 'idx': idx,
                               'from': b0.round(2).tolist(), 'to': [gx, round(float(y), 2)]})
                    shot, shooter[team], shot_i = True, idx, i
        o = f['owner']
        if o is None:
            continue
        cur = (o['team'], o['idx'])
        if last and cur != last[:2]:
            team0, idx0, li = last
            frm, to = frames[li][team0][idx0], f[o['team']][o['idx']]
            stoppage = any(g['mode'] != 'play' or g['score'] != f['score'] for g in frames[li:i + 1])
            if shot or stoppage:
                if o['team'] != team0:
                    ev.append({'t': f['t'], 'type': 'possession', 'team': o['team'], 'idx': o['idx']})
            elif o['team'] == team0:
                ev.append({'t': frames[li]['t'], 'type': 'pass', 'team': team0, 'idx': idx0,
                           'toIdx': o['idx'], 'from': frm, 'to': to, 'ok': True})
            elif i - li <= 2 and dist(f[team0][idx0], to) < 2.0:
                ev.append({'t': f['t'], 'type': 'tackle', 'team': o['team'], 'idx': o['idx'],
                           'onIdx': idx0, 'pos': to})
            else:
                ev.append({'t': frames[li]['t'], 'type': 'pass', 'team': team0, 'idx': idx0,
                           'toIdx': None, 'from': frm, 'to': to, 'ok': False})
                ev.append({'t': f['t'], 'type': 'interception', 'team': o['team'], 'idx': o['idx'], 'pos': to})
        last, shot = (o['team'], o['idx'], i), False
    return sorted(ev, key=lambda e: e['t'])


def run_base(seed, steps, out):
    env = make_env(seed, steps)
    frames, ckpt = [to_frame(0, env.observation())], {}
    for s in range(steps):
        if s % CKPT_EVERY == 0:
            ckpt[s] = env.get_state({})
        o, _, done, _ = env.step(AI)
        frames.append(to_frame(s + 1, o))
        if done:
            break
    env.close()
    with open(out + '.ckpt', 'wb') as fh:
        pickle.dump(ckpt, fh)
    return {'meta': meta(seed, steps), 'frames': frames, 'events': detect_events(frames)}


# ---- tweaks -------------------------------------------------------------------------------
# A tweak controls ONE player (agent index = side*11 + idx) for `secs`, then hands back to AI.
# GRF actions are absolute: 'right' = +x for both teams. Sticky actions (sprint, direction)
# are released explicitly before builtin_ai takes over again.
DIRS = [A.action_right, A.action_bottom_right, A.action_bottom, A.action_bottom_left,
        A.action_left, A.action_top_left, A.action_top, A.action_top_right]  # GRF angle order


def toward(src, dst):
    """8-way GRF action from src to dst, both in GRF coords (y down)."""
    ang = np.arctan2(dst[1] - src[1], dst[0] - src[0])
    return DIRS[int(round(ang / (np.pi / 4))) % 8]


def tweak_action(name, side, idx, k, n, o, state):
    """Action for the tweaked player at tweak step k; None = builtin AI plays it."""
    me = o['left_team' if side == 0 else 'right_team'][idx]
    fwd = 1 if side == 0 else -1  # attacking direction in GRF x
    if name in ('pass_early', 'shoot'):  # owner releases the ball now: aim at goal, then pass/shoot
        ph = state.get('phase', 0)
        if ph == 0 and (k >= n or o['ball_owned_team'] != side or o['ball_owned_player'] != idx):
            return None  # waits (on AI) up to n steps for the player to have the ball
        state['phase'] = ph + 1
        return [toward(me, (fwd, 0)),
                A.action_shot if name == 'shoot' else PASSES.get(state.get('kind'), A.action_short_pass),
                A.action_release_direction, None][min(ph, 3)]
    if k >= n:  # hand back to AI after releasing sticky actions
        return [A.action_release_sprint, A.action_release_direction][k - n] if k - n < 2 else None
    if name == 'sprint':  # all-out run at the opponent goal
        return A.action_sprint if k == 0 else toward(me, (fwd, 0))
    if name == 'step_up':  # defender steps up towards halfway, ignoring the line
        return A.action_right if fwd > 0 else A.action_left
    if name == 'hold_line':  # keep current depth: only shuffle sideways with the ball
        dy = o['ball'][1] - me[1]
        return A.action_release_direction if abs(dy) < 0.02 else (A.action_bottom if dy > 0 else A.action_top)
    raise ValueError(f'unknown tweak {name}')


PASSES = {'long': A.action_long_pass, 'high': A.action_high_pass}
TWEAKS = ('hold_line', 'step_up', 'pass_early', 'sprint', 'shoot')


def default_player(name, f):
    """Player to tweak if none given: owner for pass/shoot, nearest defender of the
    non-possessing team for hold_line/step_up, most advanced team-mate of the owner for sprint."""
    own = f['owner'] or {'team': 'home', 'idx': 0}
    if name in ('pass_early', 'shoot'):
        return own['team'], own['idx']
    if name == 'sprint':
        s = own['team']
        sign = 1 if s == 'home' else -1
        cand = [i for i in range(1, 11) if i != own['idx']]
        return s, max(cand, key=lambda i: sign * f[s][i][0])
    s = 'away' if own['team'] == 'home' else 'home'
    return s, min((3, 4, 5, 6), key=lambda i: dist(f[s][i], f['ball']))


def fork(base_path, at, tweak, params=None, out=None):
    params = dict(params or {})
    if tweak not in TWEAKS:
        raise ValueError(f'tweak must be one of {TWEAKS}')
    with open(base_path) as fh:
        base = json.load(fh)
    seed, steps = base['meta']['engine']['seed'], base['meta']['engine']['steps']
    step = max(0, min(int(round(at * FPS)), len(base['frames']) - 2))
    f0 = base['frames'][step]
    if params.get('player'):
        pid = str(params['player'])  # e.g. "h5" / "a4"
        if pid[:1] not in ('h', 'a') or not pid[1:].isdigit() or not 1 <= int(pid[1:]) <= 11:
            raise ValueError('player must be h1..h11 or a1..a11')
        side_name, idx = ('home' if pid[0] == 'h' else 'away'), int(pid[1:]) - 1
    else:
        side_name, idx = default_player(tweak, f0)
    side = SIDES.index(side_name)
    n = int(round(float(params.get('secs', 5)) * FPS))
    end = min(steps, step + int(round(float(params.get('len', steps)) * FPS)))

    env = make_env(seed, steps)
    ck_path, s = base_path + '.ckpt', 0
    if os.path.exists(ck_path):  # jump to nearest checkpoint, else replay from kick-off
        with open(ck_path, 'rb') as fh:
            ckpt = pickle.load(fh)
        s = max(k for k in ckpt if k <= step)
        env.set_state(ckpt[s])
    for _ in range(s, step):
        env.step(AI)
    o = env.observation()
    assert to_frame(step, o) == f0, 'replay diverged from base match (engine/seed mismatch?)'

    frames, state = [], {'kind': params.get('kind')}
    for s in range(step, end):
        acts = list(AI)
        a = tweak_action(tweak, side, idx, s - step, n, o, state)
        if a is not None:
            acts[side * 11 + idx] = a
        o, _, done, _ = env.step(acts)
        frames.append(to_frame(s + 1, o))
        if done:
            break
    env.close()

    lead = max(0, step - 5 * FPS)  # shared 5 s lead-in from the base match
    allf = base['frames'][:step + 1] + frames
    t0 = base['frames'][lead]['t']
    res = {'meta': meta(seed, steps, {'match': os.path.splitext(os.path.basename(base_path))[0],
                                      't': f0['t'], 'tweak': tweak,
                                      'params': dict(params, player=f'{side_name[0]}{idx + 1}')}),
           'frames': allf[lead:],
           'events': [e for e in detect_events(allf) if e['t'] >= t0]}
    if out:
        save(res, out)
    return res


def save(doc, path):
    with open(path, 'w') as fh:
        json.dump(doc, fh, separators=(',', ':'), ensure_ascii=False)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--seed', type=int, default=42)
    ap.add_argument('--steps', type=int, default=3000)
    ap.add_argument('--out', required=True)
    ap.add_argument('--fork', help='base match json to fork from')
    ap.add_argument('--at', type=float, help='fork time in seconds of match time')
    ap.add_argument('--tweak', choices=TWEAKS)
    ap.add_argument('--player', help='e.g. h5 or a4 (default: picked from the situation)')
    ap.add_argument('--secs', type=float, default=5, help='how long the tweak controls the player')
    ap.add_argument('--kind', choices=['short', 'long', 'high'], help='pass_early pass type')
    ap.add_argument('--len', type=float, help='seconds to simulate after the fork (default: to full time)')
    a = ap.parse_args()
    if a.fork:
        params = {k: v for k, v in (('player', a.player), ('secs', a.secs), ('kind', a.kind), ('len', a.len)) if v}
        doc = fork(a.fork, a.at, a.tweak, params, a.out)
    else:
        doc = run_base(a.seed, a.steps, a.out)
        save(doc, a.out)
    last = doc['frames'][-1]
    print(f"{a.out}: {len(doc['frames'])} frames, t={doc['frames'][0]['t']}..{last['t']}, "
          f"score {last['score']}, {len(doc['events'])} events")


if __name__ == '__main__':
    main()
