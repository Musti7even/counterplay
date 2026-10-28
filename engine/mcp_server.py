#!/usr/bin/env python3
"""MCP server exposing the match engine to agents (official `mcp` SDK, FastMCP).

  python mcp_server.py                 # stdio
  python mcp_server.py --http [port]   # streamable-http on 127.0.0.1:port/mcp (default 8766)

Runs in the py3.12 env (.tools/mcpenv); GRF itself needs py3.9, so fork_what_if shells out
to `sim.py --fork` with GRF_PYTHON (default .tools/env/bin/python). Everything else is insights.py.
"""
import functools, json, os, re, subprocess, sys

from mcp.server.fastmcp import FastMCP

import insights as I

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.normpath(os.path.join(HERE, '..', 'data'))
GRF_PYTHON = os.environ.get('GRF_PYTHON', os.path.normpath(os.path.join(HERE, '..', '..', '.tools', 'env', 'bin', 'python')))
NAME = re.compile(r'^[\w-]+$')

mcp = FastMCP('pl-match-engine', instructions=(
    'Football match engine (Google Research Football, 10 fps, 300 s per match, metres, home attacks +x). '
    'match = data file name without .json, e.g. "match" or "fork-step_up". Event ids e<N>, moment ids m<N>, '
    'player ids h1..h11 / a1..a11. Heart rate is synthetic.'), log_level=os.environ.get('MCP_LOG_LEVEL', 'INFO'))


@functools.lru_cache(maxsize=32)
def _load(name, mtime):
    with open(os.path.join(DATA, name + '.json')) as fh:
        doc = json.load(fh)
    return doc, I.analyze(doc)


def load(name):
    if not NAME.match(name) or not os.path.exists(os.path.join(DATA, name + '.json')):
        raise ValueError(f'unknown match {name!r}')
    return _load(name, os.path.getmtime(os.path.join(DATA, name + '.json')))


def pname(doc, side, idx):
    p = doc['meta'][side]['players'][idx]
    return f"{p['id']} {p['name']} ({p['pos']})"


def with_player(doc, e):
    """Event metrics + who did it (id, name, team name)."""
    ev = e['event']
    if ev.get('idx') is None:
        return e
    p = doc['meta'][ev['team']]['players'][ev['idx']]
    return dict(e, player={'id': p['id'], 'name': p['name'], 'pos': p['pos'], 'team': doc['meta'][ev['team']]['name']})


@mcp.tool()
def get_match_state(t: float, match: str = 'match') -> dict:
    """Snapshot at match time t (s): score, mode, ball, owner, all player positions, events of the last 10 s, and team stats for the last 10 s."""
    doc, ins = load(match)
    f = doc['frames'][I.fidx(doc, t)]
    o = f['owner']
    return {'t': f['t'], 'score': f['score'], 'mode': f['mode'], 'ball': f['ball'],
            'teams': {s: {'name': doc['meta'][s]['name'], 'short': doc['meta'][s]['short']} for s in I.SIDES},
            'forkOf': doc['meta'].get('forkOf'), 'end': doc['frames'][-1]['t'],
            'owner': pname(doc, o['team'], o['idx']) if o else None,
            'players': {s: {doc['meta'][s]['players'][i]['id']: p for i, p in enumerate(f[s])} for s in I.SIDES},
            'recentEvents': [e for e in ins['events'] if f['t'] - 10 <= e['event']['t'] <= f['t']],
            'last10s': I.window_stats(doc, f['t'] - 10, f['t'])}


@mcp.tool()
def get_window_stats(t0: float, t1: float, match: str = 'match') -> dict:
    """Team stats over [t0, t1]: possession %, line height, compactness, pressing, turnovers, control/chaos, momentum (+ = home)."""
    doc, _ = load(match)
    return I.window_stats(doc, t0, t1)


@mcp.tool()
def get_moments(top_k: int = 5, match: str = 'match') -> dict:
    """Top-k ranked story moments (goal, big_chance, line_breaking_pass, pressing_spell, momentum_swing, sprint_milestone) with evidence."""
    return {'moments': load(match)[1]['moments'][:top_k]}


@mcp.tool()
def get_player(id: str, t0: float = None, t1: float = None, match: str = 'match') -> dict:
    """Player load over [t0, t1] (default whole file): distance, top speed, sprints, synthetic heart rate, 1 Hz series."""
    doc, _ = load(match)
    if not re.match(r'^[ha]([1-9]|1[01])$', id):
        raise ValueError('id must be h1..h11 or a1..a11')
    return I.player_stats(doc, 'home' if id[0] == 'h' else 'away', int(id[1:]) - 1, t0, t1)


def _pid(id):
    if not re.match(r'^[ha]([1-9]|1[01])$', id):
        raise ValueError('id must be h1..h11 or a1..a11')
    return ('home' if id[0] == 'h' else 'away'), int(id[1:]) - 1


@mcp.tool()
def get_roster(match: str = 'match') -> dict:
    """Both squads: team names and players (id, number, name, position), to resolve names like 'Sørensen' to ids."""
    doc, _ = load(match)
    return {s: {'name': doc['meta'][s]['name'], 'short': doc['meta'][s]['short'], 'players': doc['meta'][s]['players']}
            for s in I.SIDES}


@mcp.tool()
def get_player_events(id: str, match: str = 'match') -> dict:
    """Events a player is part of: his passes/shots/tackles/interceptions (role actor) and tackles suffered (role beaten), with the other player's name."""
    doc, ins = load(match)
    side, idx = _pid(id)
    out = []
    for e in ins['events']:
        ev = e['event']
        if ev.get('team') == side and ev.get('idx') == idx:
            other = ev.get('onIdx') if ev['type'] == 'tackle' else None
            out.append(dict(e, role='actor', other=doc['meta'][I.other(side)]['players'][other]['name'] if other is not None else None))
        elif ev['type'] == 'tackle' and ev['team'] == I.other(side) and ev.get('onIdx') == idx:
            out.append(dict(e, role='beaten', other=doc['meta'][ev['team']]['players'][ev['idx']]['name']))
    return {'events': out}


@mcp.tool()
def get_player_snapshot(id: str, t: float, match: str = 'match') -> dict:
    """Where a player is at time t: metres from own goal, vs his back line (4 deepest outfield team-mates),
    distance to the ball, nearest opponent, current speed."""
    doc, _ = load(match)
    side, idx = _pid(id)
    i = I.fidx(doc, t)
    f = doc['frames'][i]
    depth = lambda p: round(p[0] * I.fwd(side) + 52.5, 1)  # metres from own goal line
    me = f[side][idx]
    line = round(sum(sorted(depth(p) for j, p in enumerate(f[side]) if j not in (0, idx))[:4]) / 4, 1)
    rel = round(line - depth(me), 1)  # > 0: deeper than his line
    opp = I.other(side)
    k = min(range(11), key=lambda j: I.dist(f[opp][j], me))
    return {'id': id, 't': f['t'], 'score': f['score'], 'fromOwnGoal': depth(me), 'lineFromOwnGoal': line,
            'behindLine': rel if rel > 0 else None, 'aheadOfLine': -rel if rel < 0 else None,
            'ballDist': round(I.dist(me, f['ball']), 1),
            'nearestOpponent': {'name': doc['meta'][opp]['players'][k]['name'], 'dist': round(I.dist(f[opp][k], me), 1)},
            'speed': round(float(I.player_speeds(doc, side, idx)[1][i]), 1)}


@mcp.tool()
def explain_evidence(event_id: str, match: str = 'match') -> dict:
    """Explain an event (e<N>) or moment (m<N>): metrics, the frame at that time (who was near the ball) and linked moments/events."""
    doc, ins = load(match)
    if event_id.startswith('m'):
        m = next((m for m in ins['moments'] if m['id'] == event_id), None)
        if not m:
            raise ValueError(f'unknown moment {event_id}')
        ids = m['evidence'].get('events', [])
        return {'moment': m, 'events': [with_player(doc, e) for e in ins['events'] if e['id'] in ids],
                'window': I.window_stats(doc, m['t'] - 5, m.get('t1', m['t'] + 5))}
    e = next((e for e in ins['events'] if e['id'] == event_id), None)
    if not e:
        raise ValueError(f'unknown event {event_id}')
    f = doc['frames'][I.fidx(doc, e['event']['t'])]
    near = sorted((round(I.dist(p, f['ball']), 1), pname(doc, s, i)) for s in I.SIDES for i, p in enumerate(f[s]))
    return {'event': with_player(doc, e), 'frame': {'t': f['t'], 'score': f['score'], 'ball': f['ball'], 'mode': f['mode']},
            'nearestToBall': [{'player': p, 'dist': d} for d, p in near[:6]],
            'moments': [m for m in ins['moments'] if event_id in m['evidence'].get('events', [])]}


@mcp.tool()
def list_forks(match: str = 'match') -> dict:
    """Existing fork files of `match`: name, fork time, tweak, player, length (seconds)."""
    out = []
    for fn in sorted(os.listdir(DATA)):
        name = fn[:-5]
        if not fn.startswith('fork-') or not fn.endswith('.json') or '.' in name or not NAME.match(name):
            continue
        doc, _ = load(name)
        fo = doc['meta'].get('forkOf') or {}
        if fo.get('match') == match:
            out.append({'name': name, 't': fo['t'], 'tweak': fo['tweak'], 'player': fo.get('params', {}).get('player'),
                        'until': doc['frames'][-1]['t']})
    return {'forks': out}


@mcp.tool()
def compare_fork(fork: str) -> dict:
    """Divergence summary of an existing fork vs the match it was forked from: goals prevented/created, score, player displacement."""
    f, _ = load(fork)
    if not f['meta'].get('forkOf'):
        raise ValueError(f'{fork} is not a fork')
    return I.divergence(load(f['meta']['forkOf']['match'])[0], f)


@mcp.tool()
def fork_what_if(at: float, tweak: str, player: str = None, len: float = None, secs: float = 5,
                 match: str = 'match') -> dict:
    """Re-simulate from time `at` with one tweak (hold_line | step_up | sprint | pass_early | shoot) applied to
    `player` (h1..a11, default picked from the situation) for `secs`, then builtin AI for `len` s (default to full time).
    Writes data/<fork>.json + insights; returns the fork name, divergence summary and its top moments after `at`."""
    load(match)
    name = f"fork-{tweak}-{player or 'auto'}-{int(round(at * 10))}"
    if not NAME.match(name):
        raise ValueError('bad tweak/player')
    cmd = [GRF_PYTHON, os.path.join(HERE, 'sim.py'), '--fork', os.path.join(DATA, match + '.json'),
           '--at', str(at), '--tweak', tweak, '--secs', str(secs), '--out', os.path.join(DATA, name + '.json')]
    cmd += ['--player', player] if player else []
    cmd += ['--len', str(len)] if len else []
    r = subprocess.run(cmd, capture_output=True, text=True, cwd=HERE, timeout=600)
    if r.returncode:
        raise RuntimeError(r.stderr.strip().splitlines()[-1] if r.stderr.strip() else 'fork failed')
    base, (fork, ins) = load(match)[0], load(name)
    I.write(os.path.join(DATA, name + '.json'))
    return {'fork': name, 'divergence': I.divergence(base, fork),
            'topMoments': [m for m in ins['moments'] if m['t'] >= at][:3]}


if __name__ == '__main__':
    if '--http' in sys.argv:
        rest = sys.argv[sys.argv.index('--http') + 1:]
        mcp.settings.port = int(rest[0]) if rest else 8766
        mcp.run(transport='streamable-http')
    else:
        mcp.run()
