#!/usr/bin/env python3
"""Command agent: a spoken instruction (text) -> real tool calls on the broadcast -> director cues.

  python command.py                      # the story's command lines -> data/commands/<n>.json
  python command.py "Now in Spanish."    # one-off, printed

Mode "llm": an Agent Framework Agent (Azure OpenAI / Foundry from code/.env) picks the tools.
Mode "rules": no creds (or the LLM failed): a transparent keyword/regex intent router. It is labelled
"rules" in every output and is not presented as an LLM.
Facts (roster, fork result, scores) come from the engine MCP server. If data/commands/transcripts.json
exists (transcribe.py over the voice files), its real transcripts replace the scripted texts.
Output per command: {n, text, source, audio?, mode, backend, tool_calls:[{name, args, result}], cues:[...], state, run}
"""
import argparse, asyncio, json, os, re, sys, time, unicodedata

from agent_framework import Agent, MCPStdioTool

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from crew import CODE, DATA, TOOLS, load_env, make_client  # noqa: E402

OUT = os.path.join(DATA, 'commands')
STORY = json.load(open(os.path.join(OUT, 'story.json')))  # story v4 lines (pl-hackathon/story.md)
SEGMENT = (63.0, 72.0)  # the goal moment the story keeps replaying (Moreau, 69.5 s)
GOAL_T = 69.5
WORDS = {w: i for i, w in enumerate('zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen '
                                     'fifteen sixteen seventeen eighteen nineteen'.split())}
TENS = {'twenty': 20, 'thirty': 30, 'forty': 40, 'fifty': 50, 'sixty': 60, 'seventy': 70, 'eighty': 80, 'ninety': 90}


def fold(s):
    return ''.join(ch for ch in unicodedata.normalize('NFKD', s.lower()) if not unicodedata.combining(ch)).replace('ø', 'o')


def number(text):
    """'sixty-nine' / '69' -> 69."""
    m = re.search(r'\b(\d{1,3})\b', text)
    if m:
        return int(m[1])
    m = re.search(r'\b(' + '|'.join(TENS) + r')(?:[\s-](' + '|'.join(WORDS) + r'))?\b', text)
    if m:
        return TENS[m[1]] + (WORDS[m[2]] if m[2] else 0)
    m = re.search(r'\b(' + '|'.join(WORDS) + r')\b', text)
    return WORDS[m[1]] if m else None


class Broadcast:
    """The tools the Command agent can call. Each call is recorded with its real result and cues."""

    def __init__(self, mcp, match='match'):
        self.mcp, self.match = mcp, match
        self.state = {'view': 'single', 'persona': 'casual', 'lang': 'en', 'level': 'simple', 'highlight': [], 'fork': None}
        self.calls, self.cues, self.roster = [], [], None

    async def mcp_call(self, name, **kw):
        res = await self.mcp.call_tool(name, **kw)
        return json.loads(res if isinstance(res, str) else ''.join(c.text or '' for c in res))

    def record(self, name, args, result, cues=()):
        self.calls.append({'name': name, 'args': args, 'result': result})
        self.cues.extend(cues)
        return result

    async def players(self):
        if not self.roster:
            r = await self.mcp_call('get_roster', match=self.match)
            self.roster = [dict(p, team=r[s]['name']) for s in ('home', 'away') for p in r[s]['players']]
        return self.roster

    # ---- tools (docstrings are what the LLM sees) ----
    async def seek(self, t: float) -> dict:
        """Jump playback to match time t (seconds) and play."""
        return self.record('seek', {'t': t}, {'t': t}, [{'t': t, 'speed': 1}])

    async def set_view(self, view: str) -> dict:
        """Change the broadcast layout: 'single', 'angles4' (2x2: broadcast, tactical, scorer cam, behind goal), 'split' (original vs what-if) or 'quad' (four personas)."""
        if view not in ('single', 'angles4', 'split', 'quad'):
            return self.record('set_view', {'view': view}, {'error': 'unknown view'})
        self.state['view'] = view
        cues = [{'t': SEGMENT[0], 'view': view, 'cut': True}]
        if view == 'angles4':
            cues.append({'t': SEGMENT[0], 'select': 'h8'})  # scorer cam follows Moreau
        return self.record('set_view', {'view': view}, {'view': view}, cues)

    async def fork_what_if(self, player: str, tweak: str = 'step_up', at: float | None = None) -> dict:
        """Re-simulate the moment with one change: `player` (id like a6, or a name) does `tweak` (step_up, hold_line, sprint, pass_early, shoot) from `at` seconds (default 3 s before the goal). Reuses an existing fork when one matches."""
        pid = await self.resolve(player)
        at = round(GOAL_T - 3, 1) if at is None else at
        forks = (await self.mcp_call('list_forks', match=self.match))['forks']
        f = next((f for f in sorted(forks, key=lambda f: len(f['name'])) if f['player'] == pid and f['tweak'] == tweak
                  and abs(f['t'] - at) <= 1.0), None)
        if f:
            name, reused = f['name'], True
        else:
            name = (await self.mcp_call('fork_what_if', at=at, tweak=tweak, player=pid, len=20, match=self.match))['fork']
            reused = False
        d = await self.mcp_call('compare_fork', fork=name)
        t = round(d['forkOf']['t'] + 10, 1)  # judged at the same match time in both, like the crew's fact-check
        sb = (await self.mcp_call('get_match_state', t=t, match=self.match))['score']
        sf = (await self.mcp_call('get_match_state', t=t, match=name))['score']
        base, fork = '–'.join(map(str, sb)), '–'.join(map(str, sf))
        self.state.update(view='split', fork=name)
        who = next(p for p in await self.players() if p['id'] == pid)
        result = {'fork': name, 'reused': reused, 'at': d['forkOf']['t'], 'player': pid, 'tweak': tweak,
                  'goalsPrevented': d['goalsPrevented'][:1], 'scoreAt': t, 'original': base, 'whatIf': fork}
        t0 = d['forkOf']['t']
        cues = [{'t': round(t0 - 5, 1), 'caption': {'title': 'WHAT IF · SIMULATING', 'text': f"{who['num']} {who['name']} · {tweak.replace('_', ' ')}", 'dur': 3}},
                {'t': round(t0 - 5, 1), 'view': 'split', 'cut': True, 'select': pid},
                {'t': round(t0 + 1, 1), 'view': 'ghost', 'cut': True}, {'t': round(t0 + 3, 1), 'view': 'split', 'cut': True},
                {'t': round(GOAL_T, 1), 'caption': {'title': 'RESULT', 'text': f'{base} becomes {fork}', 'dur': 4, 'side': 'whatif'}}]
        return self.record('fork_what_if', {'at': at, 'tweak': tweak, 'player': pid}, result, cues)

    async def set_persona(self, persona: str) -> dict:
        """Who the commentary is for: 'casual', 'analyst' or 'player:<id>'."""
        self.state['persona'] = persona
        return self.record('set_persona', {'persona': persona}, {'persona': persona, 'run': self.run()})

    async def set_language(self, lang: str) -> dict:
        """Commentary language: en, de, es (tr: text only)."""
        if lang not in ('en', 'de', 'tr', 'es'):
            return self.record('set_language', {'lang': lang}, {'error': 'unsupported language'})
        self.state['lang'] = lang
        return self.record('set_language', {'lang': lang}, {'lang': lang, 'run': self.run()}, [{'t': SEGMENT[0], 'view': 'single', 'cut': True}])

    async def set_commentary_level(self, level: str) -> dict:
        """'simple' (plain words, casual lens) or 'expert' (tactics, numbers, tactical lens)."""
        self.state['level'] = level
        self.state['persona'] = 'analyst' if level == 'expert' else 'casual'
        lens = 1.0 if level == 'expert' else 0.1
        return self.record('set_commentary_level', {'level': level}, {'level': level, 'run': self.run()},
                           [{'t': SEGMENT[0], 'view': 'single', 'cut': True}, {'t': SEGMENT[0], 'lensTo': lens, 'over': 1.5}])

    async def highlight_players(self, players: list[str]) -> dict:
        """Highlight players (ids like h8, a6, or names) on the pitch."""
        ids = [await self.resolve(p) for p in players]
        self.state['highlight'] = ids
        return self.record('highlight_players', {'players': ids}, {'players': ids},
                           [{'t': SEGMENT[0] + 0.5 + 3 * i, 'select': pid} for i, pid in enumerate(ids)])

    async def resolve(self, who: str) -> str:
        if re.fullmatch(r'[ha]\d{1,2}', who):
            return who
        f = fold(who)
        p = next((p for p in await self.players() if fold(p['name'].split()[-1]) in f or f in fold(p['name'])), None)
        if not p:
            raise ValueError(f'no player called {who}')
        return p['id']

    def run(self):
        r = f"{self.match}.{self.state['persona'].replace(':', '-')}.{self.state['lang']}.goal"
        return r if os.path.exists(os.path.join(DATA, f'{r}.commentary.json')) else None

    def tools(self):
        return [self.seek, self.set_view, self.fork_what_if, self.set_persona, self.set_language,
                self.set_commentary_level, self.highlight_players]


async def rules(bc, text):
    """Transparent intent router: keyword/regex rules, checked in order. Not an LLM."""
    t = fold(text)
    if re.search(r'\bminute\b|\bwatch this\b', t):
        minute = number(t)  # GRF match clock: 'minute sixty-nine' = 01:09 -> start the build-up 6 s earlier
        await bc.seek(float(max(0, minute - 6)) if minute else SEGMENT[0])
    if re.search(r'(four|4|all)\s+angles', t):
        await bc.set_view('angles4')
    if re.search(r'what (happens|if)|what would', t):
        tweak = next((k for k, pat in (('step_up', r'step(s|ped)? up'), ('hold_line', r'hold(s)? the line'), ('sprint', r'sprint|run'),
                                       ('shoot', r'shoot|shot'), ('pass_early', r'pass')) if re.search(pat, t)), 'step_up')
        names = [p['name'].split()[-1] for p in await bc.players()]
        who = next((n for n in names if fold(n) in t), None) or bc.state.get('last_player')
        if who:
            await bc.fork_what_if(who, tweak)
    else:
        who = next((p['name'].split()[-1] for p in await bc.players() if fold(p['name'].split()[-1]) in t), None)
        if who:
            bc.state['last_player'] = who  # "it's Sørensen's fault ... if he steps up"
    if re.search(r'simple|new to football|beginner|plain', t):
        await bc.set_commentary_level('simple')
    if re.search(r'full tactics|tactic|expert|analys', t):
        await bc.set_commentary_level('expert')
        await bc.highlight_players(['h8', 'a6'])  # the scorer and the defender of the story
    for lang, pat in (('tr', r'turkish|turkce'), ('de', r'german|deutsch'), ('es', r'spanish|espanol'),
                      ('en', r'\benglish\b|watch alone|\bfor me\b')):  # "when I watch alone": back to the viewer's own language
        if re.search(pat, t):
            await bc.set_language(lang)


INSTRUCTIONS = ('You control a live football broadcast (match "match"; the goal: D. Moreau scores at 69.5 s, segment 63-72 s). '
                'Turn the viewer instruction into tool calls. Use fork_what_if for "what if / what happens if" questions '
                '(resolve names like Sørensen), set_view for layouts, set_commentary_level/set_language/set_persona for '
                'commentary, highlight_players for "show/follow" players. If the line is narration and asks for nothing, call no tool.')


async def handle(bc, client, text, use_llm):
    bc.calls, bc.cues = [], []
    if use_llm:
        try:
            agent = Agent(client, INSTRUCTIONS, name='command', tools=bc.tools())
            await asyncio.wait_for(agent.run(f'Current state: {json.dumps(bc.state)}\nViewer: "{text}"'), 60)
            return 'llm'
        except Exception as e:  # recorded, then the rules router takes over
            print(f'llm failed ({type(e).__name__}: {e}); using rules', file=sys.stderr)
            bc.calls, bc.cues = [], []
    await rules(bc, text)
    return 'rules'


def utterances():
    """Real transcripts if voice files were transcribed, else the scripted story lines."""
    path = os.path.join(OUT, 'transcripts.json')
    if os.path.exists(path):
        tr = json.load(open(path))
        return [{'text': u['text'], 'source': tr.get('model', 'whisper'), 'audio': {k: u[k] for k in ('file', 'start', 'end')}}
                for u in tr['utterances']]
    return [{'text': s, 'source': 'script'} for s in STORY]


async def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('text', nargs='*')
    a = ap.parse_args()
    load_env()
    client, backend = make_client()
    py = os.environ.get('MCP_PYTHON', os.path.join(TOOLS, 'mcpenv', 'bin', 'python'))
    env = dict(os.environ, MCP_LOG_LEVEL='CRITICAL', HOME=os.environ.get('HOME', os.path.join(TOOLS, 'home')))
    async with MCPStdioTool(name='engine', command=py, args=[os.path.join(CODE, 'engine', 'mcp_server.py')],
                            env=env, load_prompts=False, request_timeout=600) as mcp:
        bc = Broadcast(mcp)
        items = [{'text': ' '.join(a.text), 'source': 'cli'}] if a.text else utterances()
        for n, u in enumerate(items, 1):
            t0 = time.time()
            mode = await handle(bc, client, u['text'], use_llm=client is not None)
            doc = dict(n=n, **u, mode=mode, backend=backend if mode == 'llm' else 'rule-based intent router (no LLM)',
                       tool_calls=bc.calls, cues=sorted(bc.cues, key=lambda q: q['t']),
                       state={k: v for k, v in bc.state.items() if k != 'last_player'}, run=bc.run(),
                       ms=int((time.time() - t0) * 1000))
            if a.text:
                print(json.dumps(doc, ensure_ascii=False, indent=1))
            else:
                json.dump(doc, open(os.path.join(OUT, f'{n}.json'), 'w'), ensure_ascii=False, indent=1)
                calls = ', '.join(f"{c['name']}({', '.join(f'{k}={v}' for k, v in c['args'].items())})" for c in doc['tool_calls'])
                print(f"{n} [{mode}] {u['text'][:60]!r} -> {calls or 'no tool'}  run={doc['run']}")


if __name__ == '__main__':
    asyncio.run(main())
