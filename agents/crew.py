#!/usr/bin/env python3
"""Broadcast agent crew (Microsoft Agent Framework) over the engine MCP server.

  python crew.py --match match --persona casual --lang en
  python crew.py --match fork-step_up --persona analyst --lang de --kill tactician

Six agents run as a WorkflowBuilder chain and hand one shared board (dict) along:
  analyst -> tactician -> whatif -> factcheck -> producer -> localizer
Every agent gets its facts from the MCP server (engine/mcp_server.py). With Azure creds in
code/.env, each agent is an LLM Agent that uses the MCP tools. Without creds (or after a
timeout/crash + one retry) it runs a deterministic template path over the same tools. The
fact-checker's numeric verification always runs, so nothing unverified airs.
Outputs: data/<match>.<persona>.<lang>.{cues,commentary,trace}.json
"""
import argparse, asyncio, json, os, re, sys, time

from agent_framework import Agent, Executor, MCPStdioTool, WorkflowBuilder, WorkflowContext, function_middleware, handler

import phrases

HERE = os.path.dirname(os.path.abspath(__file__))
CODE = os.path.dirname(HERE)
DATA = os.path.join(CODE, 'data')
TOOLS = os.path.normpath(os.path.join(CODE, '..', '.tools'))
STAGES = ['analyst', 'tactician', 'whatif', 'factcheck', 'producer', 'localizer']
TIMEOUT = {'analyst': 60, 'tactician': 60, 'whatif': 240, 'factcheck': 90, 'producer': 60, 'localizer': 90}
STYLE = {'goal': 'excited', 'big_chance': 'excited', 'whatif_prevented': 'excited', 'whatif_created': 'excited',
         'sprint_milestone': 'cheerful', 'whatif_setup': 'hopeful', 'player_load': 'newscast',
         'you_goal_for': 'excited', 'you_tackle': 'excited', 'you_intercept': 'cheerful', 'you_job': 'newscast'}  # else 'calm'
LENS = {'casual': 0.15, 'analyst': 0.8, 'player': 0.4}


def load_env():
    path = os.path.join(CODE, '.env')
    if os.path.exists(path):
        from dotenv import load_dotenv
        load_dotenv(path)


def make_client():
    """Azure OpenAI deployment, else Foundry project, else None (template mode)."""
    e = os.environ.get
    if e('AZURE_OPENAI_ENDPOINT') and e('AZURE_OPENAI_DEPLOYMENT'):
        from agent_framework.openai import OpenAIChatCompletionClient
        kw = {'api_key': e('AZURE_OPENAI_API_KEY')} if e('AZURE_OPENAI_API_KEY') else {'credential': _cred()}
        return OpenAIChatCompletionClient(model=e('AZURE_OPENAI_DEPLOYMENT'), azure_endpoint=e('AZURE_OPENAI_ENDPOINT'),
                                          api_version=e('AZURE_OPENAI_API_VERSION'), **kw), 'azure-openai'
    if e('FOUNDRY_PROJECT_ENDPOINT') and e('FOUNDRY_MODEL'):
        from agent_framework.foundry import FoundryChatClient
        return FoundryChatClient(project_endpoint=e('FOUNDRY_PROJECT_ENDPOINT'), model=e('FOUNDRY_MODEL'), credential=_cred()), 'foundry'
    return None, 'template'


def _cred():
    from azure.identity.aio import DefaultAzureCredential
    return DefaultAzureCredential()


def short(x, n=160):
    s = x if isinstance(x, str) else json.dumps(x, ensure_ascii=False, default=str)
    return s if len(s) <= n else s[:n - 1] + '…'


def numbers(x, out=None):
    """All numbers inside a JSON-ish value (incl. digits inside strings like '1-0')."""
    out = set() if out is None else out
    if isinstance(x, bool):
        return out
    if isinstance(x, (int, float)):
        out.add(round(float(x), 1))
    elif isinstance(x, str):
        out.update(round(float(m), 1) for m in re.findall(r'\d+(?:\.\d+)?', x))
    elif isinstance(x, dict):
        for v in x.values():
            numbers(v, out)
    elif isinstance(x, (list, tuple)):
        for v in x:
            numbers(v, out)
    return out


INF = float('inf')


def horizon(name, kw, out):
    """Latest match time a tool output depends on. Live broadcast: a line airing at t may only use
    outputs with horizon <= t. Whole-match outputs (get_moments, get_player_events, compare_fork,
    list_forks) are INF: fine for choosing what to look at, never as evidence for a number."""
    try:
        if name in ('get_match_state', 'get_player_snapshot'):
            return out['t']
        if name in ('get_window_stats', 'get_player'):
            return out['t1']
        if name == 'explain_evidence':
            if 'moment' in out:
                return out['window']['t1']
            e = out['event']
            return max(e['event']['t'] + (0.3 if e['event']['type'] == 'shot' else 0), e.get('tEnd', 0))  # shot speed: +0.3 s
        if name == 'fork_what_if':
            return kw['at'] + kw.get('len', INF)
    except (KeyError, TypeError):
        pass
    return INF


class Crew:
    """Shared services: MCP connection, LLM client, trace, time-stamped evidence store."""

    def __init__(self, match, persona, lang, kill, mcp, client, mode, tag=None):
        self.match, self.persona, self.lang, self.kill = match, persona, lang, kill
        self.mcp, self.client, self.mode = mcp, client, mode
        self.base = f"{match}.{persona.replace(':', '-')}.{lang}" + (f'.{tag}' if tag else '')
        self.trace, self.evidence, self.agent = [], {}, None  # evidence: number -> earliest match time it was known

    def remember(self, name, kw, out):
        h = horizon(name, kw, out)
        for n in numbers(out):
            self.evidence[n] = min(self.evidence.get(n, INF), h)

    def log(self, action, inp, out, ok=True, fallback=False, agent=None):
        self.trace.append({'t_wall': round(time.time(), 3), 'agent': agent or self.agent, 'action': action,
                           'input_summary': short(inp), 'output_summary': short(out), 'ok': ok, 'fallback': fallback})
        self.save('trace', {'run': self.base, 'mode': self.mode, 'steps': self.trace})  # live for the control room

    def save(self, kind, doc):
        with open(os.path.join(DATA, f'{self.base}.{kind}.json'), 'w') as fh:
            json.dump(doc, fh, ensure_ascii=False, indent=1 if kind != 'trace' else None)

    async def tool(self, name, **kw):
        """MCP call from a template path; output becomes verifiable evidence."""
        try:
            res = await self.mcp.call_tool(name, **kw)
            text = res if isinstance(res, str) else ''.join(c.text or '' for c in res)
            out = json.loads(text)
        except Exception as e:
            self.log(f'mcp:{name}', kw, f'{type(e).__name__}: {e}', ok=False)
            raise
        self.remember(name, kw, out)
        self.log(f'mcp:{name}', kw, out)
        return out

    async def stage(self, name, board, template):
        """Run one agent: LLM (timeout + 1 retry) -> template fallback. Returns the new board."""
        self.agent = name
        self.log('handoff', f'board keys {sorted(board)}', f'{name} starts')
        for attempt in (1, 2):
            try:
                if self.kill == name:
                    raise RuntimeError('killed (--kill demo)')
                if not self.client:
                    break
                out = await asyncio.wait_for(self.llm(name, board), TIMEOUT[name])
                self.log('llm', f'attempt {attempt}', out)
                return out
            except Exception as e:
                self.log('error', f'attempt {attempt}', f'{type(e).__name__}: {e}', ok=False)
        before = {x['id'] for x in board.get('claims', [])}
        if 'teams' not in board:  # an LLM stage may have dropped context the templates rely on
            st = await self.tool('get_match_state', t=0, match=self.match)
            board.update(teams=st['teams'], forkOf=st['forkOf'], end=st['end'])
        board.setdefault('claims', [])
        out = await template(board)
        self.log('template', 'deterministic path over MCP tools',
                 {'new_claims': [x['id'] for x in out.get('claims', []) if x['id'] not in before],
                  'claims': len(out.get('claims', [])), 'aired': out.get('aired')}, fallback=True)
        return out

    async def llm(self, name, board):
        """LLM agent with the engine MCP tools; must return the updated board as JSON."""
        crew = self

        @function_middleware
        async def trace_tools(ctx, call_next):
            await call_next()
            res = ctx.result
            text = res if isinstance(res, str) else ''.join(getattr(c, 'text', '') or '' for c in res) if isinstance(res, list) else str(res)
            try:
                crew.remember(ctx.function.name, dict(ctx.arguments), json.loads(text))
            except (ValueError, TypeError):
                pass  # unparsable tool text never counts as evidence
            crew.log(f'mcp:{ctx.function.name}', dict(ctx.arguments) if isinstance(ctx.arguments, dict) else str(ctx.arguments), text)

        tools = [] if name in ('producer', 'localizer') else [self.mcp]
        agent = Agent(self.client, ROLES[name], name=name, tools=tools, middleware=[trace_tools])
        res = await agent.run(f'Board (JSON):\n{json.dumps(board, ensure_ascii=False)}\n\n'
                              f'Return ONLY the full updated board as one JSON object.')
        m = re.search(r'\{.*\}', res.text, re.S)
        out = json.loads(m.group(0))
        if not isinstance(out, dict) or 'claims' not in out:
            raise ValueError('agent did not return a board with claims')
        return out


CLAIM = ('claim = {"id": str, "t": match seconds when it airs, "asof": latest match time of the data it uses (<= t), '
         '"kind": one of ' + ', '.join(sorted({k for v in phrases.P['en'].values() for k in v})) +
         ', "params": {numbers/names used in the text}, "evidence": [event/moment ids], "text": English line}. '
         'LIVE: a line at t may only use tool calls bounded to t (t, t1 <= t); get_moments is for choosing only')
ROLES = {
    'analyst': 'You are the Analyst of a football broadcast crew. Use the MCP tools (get_moments, get_window_stats, '
               'explain_evidence, get_player) to pick what matters for the persona in board.persona. Append claims '
               'to board.claims. ' + CLAIM + '. Only use numbers that tools returned.',
    'tactician': 'You are the Tactician. For the claims in the board, explain WHY with get_window_stats around each '
                 'moment (control vs chaos, pressing, line height, line-breaking passes). Add tactic_* claims a few '
                 'seconds after the moment they explain (replay analysis). ' + CLAIM + '. Only tool numbers.',
    'whatif': 'You are the What-If agent. For the top goal or big chance, prefer an existing fork from list_forks '
              '(forked a few seconds before it); otherwise propose one counterfactual (tweaks: hold_line, step_up, sprint, '
              'pass_early, shoot; pick a player id) and call fork_what_if (len 15). If board.forkOf is set, use compare_fork. '
              'Report the score in the original and in the fork at fork time + 10 s (get_match_state on both), not the final score. Store the result in board.whatif and add whatif_setup + whatif_prevented/created/nochange '
              'claims. ' + CLAIM + '.',
    'factcheck': 'You are the Fact-checker. Verify every claim number against explain_evidence / tool outputs. Remove '
                 'or correct claims you cannot verify; list removals in board.rejected with a reason.',
    'producer': 'You are the Producer. For board.persona decide which claims air and when (no overlapping lines, '
                'about 4 s apart, most important first). Set board.aired = [claim ids in air order] and board.script = '
                'director script {name, match, fork?, from, to, cam, lens, view?, select?, cues:[{t, cam?, cut?, lens?, '
                'lensTo?, over?, speed?, view?, select?, caption?: {"claim": id}}]}.',
    'localizer': 'You are the Localizer. Translate every aired claim text into board.lang (natural broadcast style) '
                 'and set claim.loc = {"title": short caps title, "cap": caption text, "say": spoken line}. Keep every '
                 'number exactly as in the English text.',
}


# ---- template (fallback) agents ----------------------------------------------------------

GOALS = ('goal', 'you_goal_against', 'you_goal_for')
WINDOW = 10  # what-if result is judged this many seconds after the fork point (the clip shows fork-5..fork+10)


def voice(c, cl):
    """Phrase voice for a claim: persona style; the player persona speaks to its own player."""
    kind, pid = (c.persona.split(':') + [None])[:2]
    return 'you' if kind == 'player' and cl.get('pid') == pid else 'analyst' if kind in ('analyst', 'player') else 'casual'


async def t_analyst(c, b):
    st = await c.tool('get_match_state', t=0, match=c.match)
    b.update(teams=st['teams'], forkOf=st['forkOf'], end=st['end'], claims=[])
    kind, pid = (c.persona.split(':') + [None])[:2]
    if kind == 'player' and not b['forkOf']:
        return await t_analyst_player(c, b, pid)
    moms = (await c.tool('get_moments', top_k=40, match=c.match))['moments']  # choosing only; numbers come from bounded calls
    if b['forkOf']:  # fork: only what happens around the change
        t0 = b['forkOf']['t']
        moms = [m for m in moms if t0 - 5 <= m['t'] <= t0 + 15]
    want = {'casual': ('goal', 'big_chance', 'momentum_swing', 'sprint_milestone'),
            'analyst': ('goal', 'line_breaking_pass', 'pressing_spell', 'momentum_swing', 'big_chance'),
            'player': ('goal', 'big_chance', 'line_breaking_pass', 'sprint_milestone')}[kind]
    cap = {'casual': 6, 'analyst': 9, 'player': 6}[kind]
    if b.get('window'):  # a segment (e.g. the goal at 63-72 s): only its moments
        moms = [m for m in moms if b['window'][0] <= m['t'] <= b['window'][1]]
    for m in moms:
        if m['type'] in want and len(b['claims']) < cap:
            b['claims'].append(await moment_claim(c, b, m))
    return b


async def moment_claim(c, b, m):
    """A moment as a live claim: numbers only from tool calls bounded to the time it airs."""
    ev, typ, mt = m['evidence'], m['type'], m['t']
    ids = ev.get('events', [])
    by = {}
    for i in ids:  # per-event explains are bounded to the event (+0.3 s shot speed, pass arrival)
        x = (await c.tool('explain_evidence', event_id=i, match=c.match))
        by[x['event']['event']['type']] = x
    lead = next((by[k]['event'] for k in ('shot', 'pass', 'goal') if k in by), None)
    who = lead.get('player') if lead else None
    side = lead['event']['team'] if lead else ev.get('team')
    team = b['teams'][side]['name'] if side in b['teams'] else None
    name = who and who['name']
    if typ == 'goal':
        shot = by.get('shot', {}).get('event', {})
        hr = None
        if who:  # scorer's synthetic heart rate at the goal, from load up to that instant
            hr = (await c.tool('get_player', id=who['id'], t0=0, t1=mt, match=c.match))['series']['hr'][-1]
        t, p = mt, {'player': name, 'team': team, 'score': '-'.join(map(str, by['goal']['frame']['score'])),
                    'xg': shot.get('xg'), 'dist': shot.get('distance'), 'kmh': shot.get('speedKmh'), 'hr': hr}
    elif typ == 'big_chance':
        sh = by['shot']['event']
        t = round(sh['event']['t'] + 1.5, 1)  # react once the shot is over
        await c.tool('get_match_state', t=t, match=c.match)  # the score at airtime (still no goal)
        p = {'player': name, 'team': team, 'dist': sh['distance'], 'kmh': sh['speedKmh'], 'xg': sh['xg']}
    elif typ == 'line_breaking_pass':
        pa = by['pass']['event']
        t, p = round(pa['tEnd'] + 0.5, 1), {'player': name, 'team': team, 'n': pa['bypassed'], 'dist': pa['distance']}
    elif typ == 'pressing_spell':
        w = await c.tool('get_window_stats', t0=mt, t1=m['t1'], match=c.match)
        side = ev['team']
        t, p = w['t1'], {'team': b['teams'][side]['name'], 'p': w[side]['pressing']}
    elif typ == 'momentum_swing':
        (a0, a1), (b0, b1) = ev['windows']
        wa = await c.tool('get_window_stats', t0=a0, t1=a1, match=c.match)
        wb = await c.tool('get_window_stats', t0=b0, t1=b1, match=c.match)
        side = 'home' if wb['momentum'] > wa['momentum'] else 'away'
        t, p = wb['t1'], {'team': b['teams'][side]['name'], 'a': wa['momentum'], 'b': wb['momentum']}
    else:  # sprint_milestone: his top speed so far, known at that instant
        pl = await c.tool('get_player', id=ev['player'], t0=0, t1=mt, match=c.match)
        who, t, p = {'id': ev['player']}, mt, {'player': pl['name'], 'kmh': pl['topSpeedKmh']}
    return {'id': m['id'], 't': t, 'tm': mt, 'asof': t, 'kind': typ, 'params': p, 'evidence': ids + [m['id']],
            'side': side, 'pid': who and who.get('id'), 'score': m['score']}


async def t_analyst_player(c, b, pid):
    """Player persona: only moments he is part of, all framed around him, each as of its own time."""
    me = 'home' if pid[0] == 'h' else 'away'

    def say(cid, t, kind, params, ev, score, side=me):
        b['claims'].append({'id': cid, 't': t, 'tm': t, 'asof': t, 'kind': kind, 'params': params, 'evidence': ev,
                            'pid': pid, 'side': side, 'score': score})
    for e in (await c.tool('get_player_events', id=pid, match=c.match))['events']:  # his duels (names only)
        ev = e['event']
        kind = {('tackle', 'actor'): 'you_tackle', ('tackle', 'beaten'): 'you_beaten',
                ('interception', 'actor'): 'you_intercept'}.get((ev['type'], e['role']))
        if kind:
            say(e['id'], ev['t'], kind, {'other': e['other']}, [e['id']], 60)
    for m in (await c.tool('get_moments', top_k=40, match=c.match))['moments']:  # goals, seen from where he stood
        if m['type'] != 'goal':
            continue
        by = {}
        for i in m['evidence']['events']:
            x = await c.tool('explain_evidence', event_id=i, match=c.match)
            by[x['event']['event']['type']] = x
        goal, shot = by['goal'], by.get('shot', by['goal'])
        scorer = shot['event'].get('player', {}).get('name')
        snap = await c.tool('get_player_snapshot', id=pid, t=shot['event']['event']['t'], match=c.match)
        score, gside = '-'.join(map(str, goal['frame']['score'])), goal['event']['event']['team']
        if gside == me:
            say(m['id'], m['t'], 'you_goal_for', {'scorer': scorer, 'score': score}, [m['id']], 100, gside)
        else:
            say(m['id'], m['t'], 'you_goal_against', {'scorer': scorer, 'score': score, 'near': snap['nearestOpponent']['name'],
                'near_d': snap['nearestOpponent']['dist'], 'behind': snap['behindLine'], 'ahead': snap['aheadOfLine']},
                [m['id'], f"snapshot {pid}@{snap['t']}"], 100, gside)
    t_top = (await c.tool('get_player', id=pid, match=c.match))['topSpeedT']  # when to air his load line (choosing only)
    p = await c.tool('get_player', id=pid, t0=0, t1=t_top, match=c.match)
    say(f'p-{pid}', t_top, 'player_load', {'player': p['name'], 'dist': p['distance'], 'kmh': p['topSpeedKmh'],
        'sprints': p['sprints'], 'hr': p['maxHr']}, [pid], 50)
    b['player'] = {'id': pid, 'name': p['name'], 'side': me, 'pos': p['pos']}
    return b


async def t_tactician(c, b):
    kind = c.persona.split(':')[0]
    if kind == 'player' and b.get('player'):  # one kickoff line framing his job: role + set-up, nothing from later
        pl = b['player']
        snap = await c.tool('get_player_snapshot', id=pl['id'], t=2.0, match=c.match)
        b['claims'].append({'id': 'you-job', 't': 2.0, 'tm': 2.0, 'asof': snap['t'], 'kind': 'you_job', 'pid': pl['id'],
                            'score': 70, 'evidence': [f"snapshot {pl['id']}@{snap['t']}"],
                            'params': {'player': pl['name'], 'pos': pl['pos'], 'lh': snap['lineFromOwnGoal'],
                                       'near': snap['nearestOpponent']['name']}})
        return b
    if b.get('window'):  # segment: one live build-up line at its start, from the 10 s before
        t = round(b['window'][0], 1)
        w = await c.tool('get_window_stats', t0=t - 10, t1=t, match=c.match)
        goal = next((x for x in b['claims'] if x['kind'] == 'goal'), None)
        att = (goal or {}).get('side') or ('home' if w['home']['possession'] >= 50 else 'away')
        dfn = 'away' if att == 'home' else 'home'
        T, O = b['teams'][att]['name'], b['teams'][dfn]['name']
        if kind == 'analyst':
            k, p = 'tactic_buildup', {'team': T, 'opp': O, 'poss': w[att]['possession'], 'lh': w[dfn]['lineHeight']}
        elif w['chaos'] >= 60:
            k, p = 'tactic_chaos', {'turnovers': w['turnovers'], 'chaos': w['chaos']}
        else:
            k, p = ('tactic_siege', {'team': T, 'opp': O, 'poss': w[att]['possession']}) if w[att]['possession'] >= 85 else \
                   ('tactic_control', {'team': T, 'poss': w[att]['possession'], 'control': w['control']})
        b['claims'].append({'id': f'buildup-{t}', 't': t, 'tm': t, 'asof': w['t1'], 'kind': k, 'params': p,
                            'evidence': [f"window {w['t0']}-{w['t1']}"], 'score': 60})
        return b
    off = 5 if kind == 'casual' else 4  # replay analysis right after the moment, from the 10 s before it
    for cl in [x for x in b['claims'] if x['kind'] in ('goal', 'big_chance', 'line_breaking_pass')][:4]:
        tm = cl['tm']
        w = await c.tool('get_window_stats', t0=tm - 10, t1=tm, match=c.match)
        att = cl.get('side') or 'home'
        dfn = 'away' if att == 'home' else 'home'
        T, O = b['teams'][att]['name'], b['teams'][dfn]['name']
        if w['chaos'] >= 60:
            new = ('tactic_chaos', {'turnovers': w['turnovers'], 'chaos': w['chaos']})
        elif w[att]['possession'] >= 85:
            new = ('tactic_siege', {'team': T, 'opp': O, 'poss': w[att]['possession']})
        else:
            new = ('tactic_control', {'team': T, 'poss': w[att]['possession'], 'control': w['control']})
        add = [(new, off)]
        if kind == 'analyst':  # "the gap X ran into": the defending line before the chance
            add.append((('tactic_line', {'team': O, 'lh': w[dfn]['lineHeight'], 'who': cl['params'].get('player')}), 7.5))
        for (k, p), dt in add:
            b['claims'].append({'id': f"{cl['id']}-{k}", 't': round(tm + dt, 1), 'tm': tm, 'asof': w['t1'], 'kind': k,
                                'params': p, 'evidence': [cl['id'], f"window {w['t0']}-{w['t1']}"],
                                'score': 40 if kind == 'analyst' else 20})
    return b


async def pick_fork(c, b, top):
    """Prefer an existing fork of this moment (the demo's fork-step_up), else create one."""
    kind, mine = (c.persona.split(':') + [''])[:2]
    forks = [f for f in (await c.tool('list_forks', match=c.match))['forks'] if top['tm'] - 6 <= f['t'] < top['tm']]
    if forks:  # deterministic: the persona's own player, then step_up, then the shortest (canonical) name
        f = min(forks, key=lambda f: (f['player'] != mine, f['tweak'] != 'step_up', len(f['name']), f['name']))
        return f['name']
    at = round(top['tm'] - 3, 1)
    st = await c.tool('get_match_state', t=at, match=c.match)
    dfn = 'away' if top.get('side') == 'home' else 'home'
    ball = st['ball']
    pid = min((f'{dfn[0]}{i}' for i in (4, 5, 6, 7)),  # CBs/FBs: nearest defender to the ball steps up
              key=lambda k: (st['players'][dfn][k][0] - ball[0]) ** 2 + (st['players'][dfn][k][1] - ball[1]) ** 2)
    if mine[:1] == dfn[0] and mine[1:] in ('4', '5', '6', '7'):
        pid = mine  # player persona: make it his what-if
    return (await c.tool('fork_what_if', at=at, tweak='step_up', player=pid, len=20, match=c.match))['fork']


async def window_scores(c, base, fork, t):
    """Score in the original and in the what-if at the same match time."""
    sb = (await c.tool('get_match_state', t=t, match=base))['score']
    sf = (await c.tool('get_match_state', t=t, match=fork))['score']
    return '-'.join(map(str, sb)), '-'.join(map(str, sf))


async def t_whatif(c, b):
    if b.get('window'):
        return b  # segments are about the moment itself; the what-if has its own runs
    if b['forkOf']:
        name = c.match
    else:
        top = next((x for x in b['claims'] if x['kind'] in GOALS), None) or next((x for x in b['claims'] if x['kind'] == 'big_chance'), None)
        if not top:
            return b
        name = b['whatifFork'] = await pick_fork(c, b, top)
    d = await c.tool('compare_fork', fork=name)  # which goals differ (choosing only); the scores are re-read at airtime
    fo = d['forkOf']
    pid = fo['params']['player']
    pl = await c.tool('get_player', id=pid, t0=fo['t'], t1=fo['t'], match=fo['match'])
    if b['forkOf']:  # fork clip: open with the question, answer when the original goal would have gone in
        t_setup = fo['t'] - 4
        g = next((g for g in d['goalsPrevented'] if g[0] <= fo['t'] + WINDOW), None) or \
            next((g for g in d['goalsCreated'] if g[0] <= fo['t'] + WINDOW), None)
        t_res = round(g[0] + 0.5 if g else fo['t'] + WINDOW, 1)
    else:  # full match: tell it after the goal and its replay analysis
        goal_t = next((x['tm'] for x in b['claims'] if x['kind'] in GOALS), fo['t'])
        t_setup, t_res = goal_t + 11.5, goal_t + 17
    base, fork = await window_scores(c, fo['match'], name, t_res)
    b['whatif'] = dict(d, atAirtime={'t': t_res, 'base': base, 'fork': fork})
    b['claims'].append({'id': 'w-setup', 't': round(t_setup, 1), 'asof': round(t_setup, 1), 'kind': 'whatif_setup', 'pid': pid,
                        'evidence': ['compare_fork', name, pid], 'params': {'player': pl['name'], 'tweak': fo['tweak']}, 'score': 90})
    prevented = [g for g in d['goalsPrevented'] if g[0] <= t_res]
    created = [g for g in d['goalsCreated'] if g[0] <= t_res]
    if prevented:
        k, p = 'whatif_prevented', {'t': prevented[0][0], 'base': base, 'fork': fork}
    elif created:
        k, p = 'whatif_created', {'team': b['teams'][created[0][1]]['name'], 'base': base, 'fork': fork}
    else:
        k, p = 'whatif_nochange', {'fork': fork}
    b['claims'].append({'id': 'w-result', 't': round(t_res, 1), 'asof': round(t_res, 1), 'kind': k, 'params': p, 'pid': pid,
                        'evidence': ['compare_fork', name, f'score@{t_res}'], 'score': 95,
                        'check': {'t': round(t_res, 1), 'base_match': fo['match'], 'fork_match': name}})
    return b


async def t_factcheck(c, b):
    return b  # the verification below runs for every mode


def ok_num(c, n, t):
    """Verified = a tool returned it (to 0.1, or as a whole-number rounding) from data up to match time t."""
    return any(h <= t + 1e-6 and (e == n or (float(n).is_integer() and abs(e - n) < 0.5)) for e, h in c.evidence.items())


async def verify(c, b):
    """Deterministic gate for a live broadcast: a claim may not use data from after it airs (asof <= t), every
    number must come from a tool output bounded to its airtime, and what-if score pairs are re-read from both
    matches at that time and must match exactly."""
    ok, rej = [], list(b.get('rejected', []))
    c.agent = 'factcheck'
    for cl in b['claims']:
        t = cl.get('t', -1)
        nums = numbers(cl.get('params', {})) | numbers(cl.get('text', ''))
        bad = sorted(n for n in nums if not ok_num(c, n, t))
        missing = [k for k, v in cl.get('params', {}).items() if v is None and k in ('player', 'team')]
        why = None
        if not any(cl.get('kind') in v for v in phrases.P['en'].values()):
            why = f"unknown kind {cl.get('kind')}"
        elif cl.get('asof', t) > t + 1e-6:
            why = f"uses data up to {cl['asof']} but airs at {t}"
        elif bad or missing:
            why = f'numbers not known by t={t}: {bad}' if bad else f'missing {missing}'
        elif cl.get('check'):
            k = cl['check']
            pair = await window_scores(c, k['base_match'], k['fork_match'], k['t'])
            claimed = (cl['params'].get('base', pair[0]), cl['params'].get('fork'))
            why = None if claimed == pair and k['t'] <= t else f'score pair {claimed} != tools {pair} at t={k["t"]}'
            c.log('check-pair', k, {'claimed': claimed, 'tools': pair, 'ok': why is None}, ok=why is None)
        if why:
            rej.append({'id': cl.get('id'), 'reason': why})
        else:
            ok.append(cl)
    b['claims'], b['rejected'] = ok, rej
    c.log('verify', f"{len(ok) + len(rej)} claims, live rule: evidence time <= airtime",
          {'aired_ok': [x['id'] for x in ok], 'rejected': rej})
    return b


async def t_producer(c, b):
    kind, pid = (c.persona.split(':') + [None])[:2]
    cl = sorted(b['claims'], key=lambda x: -x.get('score', 50))
    aired, busy = [], []
    gap = {'casual': 5, 'analyst': 3.5, 'player': 4}[kind]
    for x in cl:  # most important first; drop lines that would talk over a better one
        if all(abs(x['t'] - y) >= gap for y in busy):
            aired.append(x['id'])
            busy.append(x['t'])
    byid = {x['id']: x for x in b['claims']}
    if b.get('window'):
        aired = [i for i in aired if b['window'][0] <= byid[i]['t'] <= b['window'][1]]
    aired.sort(key=lambda i: byid[i]['t'])
    fo = b['forkOf']
    if fo:
        t0 = fo['t']
        s = {'name': c.base, 'match': fo['match'], 'fork': c.match, 'from': round(t0 - 5, 1), 'to': round(t0 + WINDOW, 1),
             'view': 'split', 'cam': 'broadcast', 'lens': LENS[kind], 'select': fo['params']['player'], 'cues': []}
        s['cues'] += [{'t': round(t0 - 0.5, 1), 'speed': 0.5}, {'t': round(t0 + 1, 1), 'view': 'ghost', 'cut': True, 'speed': 0.7},
                      {'t': round(t0 + 3, 1), 'view': 'split', 'cut': True}, {'t': round(t0 + 6, 1), 'speed': 1}]
    else:
        s = {'name': c.base, 'match': c.match, 'from': 0, 'to': b['end'], 'cam': 'broadcast', 'lens': LENS[kind],
             'select': pid, 'cues': []}
        if b.get('window'):
            s['from'], s['to'] = b['window']
    for i in aired:
        x = byid[i]
        if x['kind'] == 'goal' and not fo:
            s['cues'] += [{'t': round(x['t'] - 2, 1), 'speed': 0.5}, {'t': round(x['t'] + 0.5, 1), 'speed': 1}]
        if kind == 'analyst' and x['kind'] in ('line_breaking_pass', 'pressing_spell') and not fo:
            s['cues'] += [{'t': round(x['t'] - 3, 1), 'cam': 'tactical'}, {'t': round(x['t'] + 3, 1), 'cam': 'broadcast'}]
        if kind == 'player' and not fo and x['kind'] in ('you_tackle', 'you_beaten', 'you_intercept', 'you_goal_against', 'you_goal_for'):
            s['cues'] += [{'t': max(0, round(x['t'] - 4, 1)), 'cam': 'player', 'select': pid}, {'t': round(x['t'] + 2, 1), 'cam': 'broadcast'}]
        cap = {'claim': i}
        if fo and x['kind'].startswith('whatif_') and x['kind'] != 'whatif_setup':
            cap['side'] = 'whatif'  # split view: result banner on the what-if half
        s['cues'].append({'t': x['t'], 'caption': cap})
    if kind == 'analyst' and not fo:
        s['cues'].insert(0, {'t': 1, 'lensTo': 0.8, 'over': 3})
    s['cues'].sort(key=lambda q: q['t'])
    b['aired'], b['script'] = aired, s
    return b


async def t_localizer(c, b):
    byid, seen = {x['id']: x for x in b['claims']}, {}
    for i in b['aired']:
        x = byid[i]
        n = seen[x['kind']] = seen.get(x['kind'], -1) + 1  # nth time this kind airs -> phrase variant
        if b.get('shortest'):  # tight segment: the shortest variant, so lines don't talk over each other
            n = min(range(3), key=lambda k: len(phrases.render(x['kind'], x['params'], c.lang, voice(c, x), k)[2]))
        title, cap, say = phrases.render(x['kind'], x['params'], c.lang, voice(c, x), n)
        x['loc'] = {'title': title, 'cap': cap, 'say': say}
    return b


TEMPLATES = {'analyst': t_analyst, 'tactician': t_tactician, 'whatif': t_whatif, 'factcheck': t_factcheck,
             'producer': t_producer, 'localizer': t_localizer}


def finalize(c, b):
    """Resolve caption placeholders, re-check localized numbers, write cues + commentary."""
    byid = {x['id']: x for x in b['claims']}
    lines = []
    for i in b['aired']:
        x = byid.get(i)
        if not x:
            continue
        loc = x.get('loc') or {}
        if not loc.get('say') or any(not ok_num(c, n, x['t']) for n in numbers(loc['say'])):
            tmpl = phrases.render(x['kind'], x['params'], c.lang, voice(c, x))
            loc = {'title': tmpl[0], 'cap': tmpl[1], 'say': tmpl[2]}  # LLM localization drifted: use template
            c.log('localize-fallback', i, loc['say'], fallback=True, agent='localizer')
        x['loc'] = loc
        lines.append({'t': x['t'], 'text': loc['say'], 'voice_style': STYLE.get(x['kind'], 'calm'),
                      'claim': i, 'evidence': x['evidence']})
    aired = {l['claim'] for l in lines}
    b['script']['cues'] = [q for q in b['script']['cues']
                           if not (isinstance(q.get('caption'), dict) and q['caption'].get('claim') not in (aired | {None}))]
    for q in b['script']['cues']:
        if isinstance(q.get('caption'), dict) and 'claim' in q['caption']:
            loc = byid[q['caption']['claim']]['loc']
            q['caption'] = dict({'title': loc['title'], 'text': loc['cap'] or loc['say'], 'dur': 3.5},
                                **({'side': q['caption']['side']} if 'side' in q['caption'] else {}))
    c.save('cues', b['script'])
    c.save('commentary', lines)
    c.agent = 'crew'
    c.log('done', c.base, f"{len(lines)} lines, {len(b['script']['cues'])} cues, {len(b.get('rejected', []))} rejected")
    return lines


class Stage(Executor):
    def __init__(self, crew, name):
        super().__init__(id=name)
        self.crew = crew

    @handler
    async def run(self, board: dict, ctx: WorkflowContext[dict, dict]) -> None:
        c = self.crew
        board = await c.stage(self.id, board, lambda b: TEMPLATES[self.id](c, b))
        if self.id == 'factcheck':
            board = await verify(c, board)
        if self.id == 'localizer':
            await ctx.yield_output(board)
        else:
            await ctx.send_message(board)


async def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--match', default='match')
    ap.add_argument('--persona', default='casual', help='casual | analyst | player:<id>')
    ap.add_argument('--lang', default='en', choices=phrases.LANGS)
    ap.add_argument('--kill', choices=STAGES, help='make this agent crash to demo recovery')
    ap.add_argument('--window', nargs=2, type=float, metavar=('T0', 'T1'), help='only this segment, e.g. 63 72 for the goal')
    ap.add_argument('--shortest', action='store_true', help='use the shortest phrase variant (tight segments)')
    ap.add_argument('--tag', help='extra output name part, e.g. killtactician -> <match>.<persona>.<lang>.killtactician.*')
    a = ap.parse_args()
    load_env()
    client, mode = make_client()
    py = os.environ.get('MCP_PYTHON', os.path.join(TOOLS, 'mcpenv', 'bin', 'python'))
    env = dict(os.environ, MCP_LOG_LEVEL='CRITICAL', HOME=os.environ.get('HOME', os.path.join(TOOLS, 'home')))
    async with MCPStdioTool(name='engine', command=py, args=[os.path.join(CODE, 'engine', 'mcp_server.py')],
                            env=env, load_prompts=False, request_timeout=600) as mcp:
        c = Crew(a.match, a.persona, a.lang, a.kill, mcp, client, mode, a.tag)
        c.agent = 'crew'
        c.log('start', vars(a), f'mode={mode}, tools={[f.name for f in mcp.functions]}')
        stages = [Stage(c, n) for n in STAGES]
        wf = WorkflowBuilder(start_executor=stages[0]).add_chain(stages).build()
        res = await wf.run({'match': a.match, 'persona': a.persona, 'lang': a.lang, 'window': a.window, 'shortest': a.shortest})
        lines = finalize(c, res.get_outputs()[0])
    print(f'{c.base}: mode={mode}, {len(lines)} lines, {sum(1 for s in c.trace if s["fallback"])} fallbacks, '
          f'{sum(1 for s in c.trace if not s["ok"])} errors')
    for l in lines:
        print(f"  {l['t']:6.1f}  [{l['voice_style']}] {l['text']}")


if __name__ == '__main__':
    asyncio.run(main())
