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
         'sprint_milestone': 'cheerful', 'whatif_setup': 'hopeful', 'player_load': 'newscast'}  # else 'calm'
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


class Crew:
    """Shared services: MCP connection, LLM client, trace, evidence store."""

    def __init__(self, match, persona, lang, kill, mcp, client, mode):
        self.match, self.persona, self.lang, self.kill = match, persona, lang, kill
        self.mcp, self.client, self.mode = mcp, client, mode
        self.base = f"{match}.{persona.replace(':', '-')}.{lang}"
        self.trace, self.evidence, self.agent = [], set(), None

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
        self.evidence |= numbers(out)
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
            text = res if isinstance(res, str) else json.dumps([getattr(c, 'text', str(c)) for c in res]) if isinstance(res, list) else str(res)
            crew.evidence |= numbers(text)
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


CLAIM = ('claim = {"id": str, "t": match seconds, "kind": one of ' + ', '.join(phrases.P['en']) +
         ', "params": {numbers/names used in the text}, "evidence": [event/moment ids], "text": English line}')
ROLES = {
    'analyst': 'You are the Analyst of a football broadcast crew. Use the MCP tools (get_moments, get_window_stats, '
               'explain_evidence, get_player) to pick what matters for the persona in board.persona. Append claims '
               'to board.claims. ' + CLAIM + '. Only use numbers that tools returned.',
    'tactician': 'You are the Tactician. For the claims in the board, explain WHY with get_window_stats around each '
                 'moment (control vs chaos, pressing, line height, line-breaking passes). Add tactic_* claims a few '
                 'seconds before the moment they explain. ' + CLAIM + '. Only tool numbers.',
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

WINDOW = 10  # what-if result is judged this many seconds after the fork point (the clip shows fork-5..fork+10)


def voice(c, cl):
    """Phrase voice for a claim: persona style; the player persona speaks to its own player."""
    kind, pid = (c.persona.split(':') + [None])[:2]
    return 'you' if kind == 'player' and cl.get('pid') == pid else 'analyst' if kind in ('analyst', 'player') else 'casual'


async def t_analyst(c, b):
    st = await c.tool('get_match_state', t=0, match=c.match)
    b.update(teams=st['teams'], forkOf=st['forkOf'], end=st['end'], claims=[])
    kind, pid = (c.persona.split(':') + [None])[:2]
    moms = (await c.tool('get_moments', top_k=40, match=c.match))['moments']
    if b['forkOf']:  # fork: only what happens around the change
        t0 = b['forkOf']['t']
        moms = [m for m in moms if t0 - 5 <= m['t'] <= t0 + 15]
    want = {'casual': ('goal', 'big_chance', 'momentum_swing', 'sprint_milestone'),
            'analyst': ('goal', 'line_breaking_pass', 'pressing_spell', 'momentum_swing', 'big_chance'),
            'player': ('goal', 'big_chance', 'line_breaking_pass', 'sprint_milestone')}[kind]
    picks, cap = [], {'casual': 6, 'analyst': 9, 'player': 6}[kind]
    for m in moms:
        if m['type'] not in want or len(picks) >= cap:
            continue
        ex = await c.tool('explain_evidence', event_id=m['id'], match=c.match) if m['evidence'].get('events') else {'events': []}
        who = next((e['player'] for e in ex['events'] if e.get('player')), None)
        if m['type'] == 'sprint_milestone':
            who = await c.tool('get_player', id=m['evidence']['player'], t0=m['t'], t1=m['t'], match=c.match)
        if kind == 'player' and m['type'] != 'goal' and (who or {}).get('id') != pid:
            continue
        picks.append(m['id'])
        b['claims'].append(moment_claim(c, b, m, ex, who))
    if kind == 'player':
        p = await c.tool('get_player', id=pid, match=c.match)
        b['claims'].append({'id': f'p-{pid}', 't': p['topSpeedT'], 'kind': 'player_load', 'evidence': [pid], 'pid': pid,
                            'params': {'player': p['name'], 'dist': p['distance'], 'kmh': p['topSpeedKmh'],
                                       'sprints': p['sprints'], 'hr': p['maxHr']}})
    b['picks'] = picks
    return b


def moment_claim(c, b, m, ex, who):
    ev, team = m['evidence'], None
    e0 = next((e for e in ex['events'] if e['event']['type'] in ('shot', 'pass')), ex['events'][0] if ex['events'] else None)
    if e0:
        team = b['teams'][e0['event']['team']]['name']
    name = who and who['name']
    p = {'goal': lambda: {'player': name, 'team': team, 'score': '-'.join(map(str, ev['scoreAfter'])), 'xg': ev.get('xg'),
                          'dist': e0.get('distance') if e0 else None},
         'big_chance': lambda: {'player': name, 'team': team, 'dist': ev['distance'], 'kmh': ev['speedKmh'], 'xg': ev['xg']},
         'line_breaking_pass': lambda: {'player': name, 'team': team, 'n': ev['bypassed'], 'dist': ev['distance']},
         'pressing_spell': lambda: {'team': b['teams'][ev['team']]['name'], 'p': ev['pressing']},
         'momentum_swing': lambda: {'team': b['teams']['home' if ev['to'] > ev['from'] else 'away']['name'], 'a': ev['from'], 'b': ev['to']},
         'sprint_milestone': lambda: {'player': name, 'kmh': ev['topSpeedKmh']},
         }[m['type']]()
    return {'id': m['id'], 't': m['t'], 'kind': m['type'], 'params': p, 'evidence': ev.get('events', []) + [m['id']],
            'side': e0['event']['team'] if e0 else ev.get('team'), 'pid': who and who.get('id'), 'score': m['score']}


async def t_tactician(c, b):
    kind = c.persona.split(':')[0]
    for cl in [x for x in b['claims'] if x['kind'] in ('goal', 'big_chance', 'line_breaking_pass')][:4]:
        w = await c.tool('get_window_stats', t0=cl['t'] - 10, t1=cl['t'], match=c.match)
        att = cl.get('side') or 'home'
        dfn = 'away' if att == 'home' else 'home'
        T, O = b['teams'][att]['name'], b['teams'][dfn]['name']
        if w['chaos'] >= 60:
            new = ('tactic_chaos', {'turnovers': w['turnovers'], 'chaos': w['chaos']})
        elif w[att]['possession'] >= 85:
            new = ('tactic_siege', {'team': T, 'opp': O, 'poss': w[att]['possession']})
        else:
            new = ('tactic_control', {'team': T, 'poss': w[att]['possession'], 'control': w['control']})
        add = [new]
        if kind in ('analyst', 'player'):  # "the gap X runs into": defending line height before the chance
            add.append(('tactic_line', {'team': O, 'lh': w[dfn]['lineHeight'], 'who': cl['params'].get('player')}))
        for i, (k, p) in enumerate(add):
            b['claims'].append({'id': f"{cl['id']}-{k}", 't': round(cl['t'] - 7 + 3.5 * i, 1), 'kind': k, 'params': p,
                                'evidence': [cl['id'], f"window {w['t0']}-{w['t1']}"], 'score': 40 if kind == 'analyst' else 20})
    return b


async def pick_fork(c, b, top):
    """Prefer an existing fork of this moment (the demo's fork-step_up), else create one."""
    kind, mine = (c.persona.split(':') + [''])[:2]
    forks = [f for f in (await c.tool('list_forks', match=c.match))['forks'] if top['t'] - 6 <= f['t'] < top['t']]
    if forks:  # deterministic: the persona's own player, then step_up, then the shortest (canonical) name
        f = min(forks, key=lambda f: (f['player'] != mine, f['tweak'] != 'step_up', len(f['name']), f['name']))
        return f['name']
    at = round(top['t'] - 3, 1)
    st = await c.tool('get_match_state', t=at, match=c.match)
    dfn = 'away' if top.get('side') == 'home' else 'home'
    ball = st['ball']
    pid = min((f'{dfn[0]}{i}' for i in (4, 5, 6, 7)),  # CBs/FBs: nearest defender to the ball steps up
              key=lambda k: (st['players'][dfn][k][0] - ball[0]) ** 2 + (st['players'][dfn][k][1] - ball[1]) ** 2)
    if mine[:1] == dfn[0] and mine[1:] in ('4', '5', '6', '7'):
        pid = mine  # player persona: make it his what-if
    return (await c.tool('fork_what_if', at=at, tweak='step_up', player=pid, len=WINDOW + 5, match=c.match))['fork']


async def window_scores(c, base, fork, t):
    """Score in the original and in the what-if at the same match time."""
    sb = (await c.tool('get_match_state', t=t, match=base))['score']
    sf = (await c.tool('get_match_state', t=t, match=fork))['score']
    return '-'.join(map(str, sb)), '-'.join(map(str, sf))


async def t_whatif(c, b):
    if b['forkOf']:
        name = c.match
    else:
        top = next((x for x in b['claims'] if x['kind'] == 'goal'), None) or next((x for x in b['claims'] if x['kind'] == 'big_chance'), None)
        if not top:
            return b
        name = b['whatifFork'] = await pick_fork(c, b, top)
    d = await c.tool('compare_fork', fork=name)
    fo = d['forkOf']
    pid = fo['params']['player']
    t_end = round(fo['t'] + WINDOW, 1)
    base, fork = await window_scores(c, fo['match'], name, t_end)
    pl = await c.tool('get_player', id=pid, t0=fo['t'], t1=fo['t'], match=fo['match'])
    b['whatif'] = dict(d, window={'t': t_end, 'base': base, 'fork': fork})
    goal_t = next((x['t'] for x in b['claims'] if x['kind'] == 'goal'), fo['t'])
    t_setup = fo['t'] - 4 if b['forkOf'] else goal_t + 5  # fork clip: open with it; base match: after the goal
    b['claims'].append({'id': 'w-setup', 't': round(t_setup, 1), 'kind': 'whatif_setup', 'pid': pid,
                        'evidence': ['compare_fork', name, pid], 'params': {'player': pl['name'], 'tweak': fo['tweak']}, 'score': 90})
    prevented = [g for g in d['goalsPrevented'] if g[0] <= t_end]
    created = [g for g in d['goalsCreated'] if g[0] <= t_end]
    if prevented:
        k, p, t = 'whatif_prevented', {'t': prevented[0][0], 'base': base, 'fork': fork}, prevented[0][0]
    elif created:
        k, p, t = 'whatif_created', {'team': b['teams'][created[0][1]]['name'], 'base': base, 'fork': fork}, created[0][0]
    else:
        k, p, t = 'whatif_nochange', {'fork': fork}, t_end
    b['claims'].append({'id': 'w-result', 't': round(t if b['forkOf'] else t_setup + 5, 1), 'kind': k, 'params': p, 'pid': pid,
                        'evidence': ['compare_fork', name, f'score@{t_end}'], 'score': 95,
                        'check': {'t': t_end, 'base_match': fo['match'], 'fork_match': name}})
    return b


async def t_factcheck(c, b):
    return b  # the verification below runs for every mode


def ok_num(c, n):
    """A number is verified if a tool returned it (to 0.1) or it is a whole-number rounding of one."""
    return n in c.evidence or (float(n).is_integer() and any(abs(e - n) < 0.5 for e in c.evidence))


async def verify(c, b):
    """Deterministic gate: every number in params (and in LLM text) must come from a tool output;
    what-if score pairs are re-read from both matches at the same time and must match exactly."""
    ok, rej = [], list(b.get('rejected', []))
    c.agent = 'factcheck'
    for cl in b['claims']:
        nums = numbers(cl.get('params', {})) | numbers(cl.get('text', ''))
        bad = sorted(n for n in nums if not ok_num(c, n))
        missing = [k for k, v in cl.get('params', {}).items() if v is None and k in ('player', 'team')]
        why = None
        if cl.get('kind') not in phrases.P['en']['casual']:
            why = f"unknown kind {cl.get('kind')}"
        elif bad or missing:
            why = f'unverified numbers {bad}' if bad else f'missing {missing}'
        elif cl.get('check'):
            k = cl['check']
            pair = await window_scores(c, k['base_match'], k['fork_match'], k['t'])
            claimed = (cl['params'].get('base', pair[0]), cl['params'].get('fork'))
            why = None if claimed == pair else f'score pair {claimed} != tools {pair} at t={k["t"]}'
            c.log('check-pair', k, {'claimed': claimed, 'tools': pair, 'ok': why is None}, ok=why is None)
        if why:
            rej.append({'id': cl.get('id'), 'reason': why})
        else:
            ok.append(cl)
    b['claims'], b['rejected'] = ok, rej
    c.log('verify', f"{len(ok) + len(rej)} claims vs {len(c.evidence)} numbers seen in tool outputs",
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
    for i in aired:
        x = byid[i]
        if x['kind'] == 'goal' and not fo:
            s['cues'] += [{'t': round(x['t'] - 2, 1), 'speed': 0.5}, {'t': round(x['t'] + 0.5, 1), 'speed': 1}]
        if kind == 'analyst' and x['kind'] in ('line_breaking_pass', 'pressing_spell') and not fo:
            s['cues'] += [{'t': round(x['t'] - 3, 1), 'cam': 'tactical'}, {'t': round(x['t'] + 3, 1), 'cam': 'broadcast'}]
        if kind == 'player' and not fo and x['kind'] != 'player_load':
            s['cues'] += [{'t': round(x['t'] - 4, 1), 'cam': 'player', 'select': pid}, {'t': round(x['t'] + 3, 1), 'cam': 'broadcast'}]
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
        if not loc.get('say') or any(not ok_num(c, n) for n in numbers(loc['say'])):
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
    a = ap.parse_args()
    load_env()
    client, mode = make_client()
    py = os.environ.get('MCP_PYTHON', os.path.join(TOOLS, 'mcpenv', 'bin', 'python'))
    env = dict(os.environ, MCP_LOG_LEVEL='CRITICAL', HOME=os.environ.get('HOME', os.path.join(TOOLS, 'home')))
    async with MCPStdioTool(name='engine', command=py, args=[os.path.join(CODE, 'engine', 'mcp_server.py')],
                            env=env, load_prompts=False, request_timeout=600) as mcp:
        c = Crew(a.match, a.persona, a.lang, a.kill, mcp, client, mode)
        c.agent = 'crew'
        c.log('start', vars(a), f'mode={mode}, tools={[f.name for f in mcp.functions]}')
        stages = [Stage(c, n) for n in STAGES]
        wf = WorkflowBuilder(start_executor=stages[0]).add_chain(stages).build()
        res = await wf.run({'match': a.match, 'persona': a.persona, 'lang': a.lang})
        lines = finalize(c, res.get_outputs()[0])
    print(f'{c.base}: mode={mode}, {len(lines)} lines, {sum(1 for s in c.trace if s["fallback"])} fallbacks, '
          f'{sum(1 for s in c.trace if not s["ok"])} errors')
    for l in lines:
        print(f"  {l['t']:6.1f}  [{l['voice_style']}] {l['text']}")


if __name__ == '__main__':
    asyncio.run(main())
