# agents: broadcast crew

This is a six-agent crew built on Microsoft Agent Framework (`agent-framework-core` 1.23, `WorkflowBuilder` chain). It reads the match through the engine MCP server (`../engine/mcp_server.py`, stdio) and produces director cues and commentary for each persona and language.

The agents run in this order:
1. **analyst**: picks moments.
2. **tactician**: explains why, from window stats.
3. **whatif**: runs `fork_what_if`, or `compare_fork` when the input is already a fork.
4. **factcheck**: checks every number.
5. **producer**: decides what airs and when, and writes the cue script.
6. **localizer**: produces en, es, tr or de.

They all work on one shared board (a dict) that is handed down the chain.

```bash
T=../../.tools
$T/bin/micromamba create -y -p $T/agentenv -c conda-forge python=3.12 pip
$T/agentenv/bin/pip install 'agent-framework-core[all]' azure-cognitiveservices-speech   # needs mcp>=2.2, hence its own env
$T/agentenv/bin/python crew.py --match match --persona casual --lang en
$T/agentenv/bin/python crew.py --match fork-step_up --persona analyst --lang es
$T/agentenv/bin/python crew.py --persona player:a6 --lang de --kill tactician     # demo recovery
$T/agentenv/bin/python voice.py ../data/match.casual.en.commentary.json          # Azure TTS; skips without key
```

**Outputs**, as `data/<match>.<persona>.<lang>.*`:
- `cues.json`: the web director script. Play it with `?cues=/data/match.casual.en.cues.json`.
- `commentary.json`: `[{t, text, voice_style, claim, evidence}]`.
- `trace.json`: `{run, mode, steps: [{t_wall, agent, action, input_summary, output_summary, ok, fallback}]}`. It is rewritten after every step, so a UI can poll it.

**Modes:**
- **LLM mode.** With creds in `code/.env`, each agent is an LLM `Agent` with the MCP server as its tool source. Its MCP calls are traced through function middleware.
- **Template mode.** Without creds (`mode=template`), each agent runs a deterministic template path over the same MCP tools.
- **Recovery.** In LLM mode, a timeout or exception gets one retry, then the template path takes over (`fallback: true` in the trace). `--kill <agent>` forces that path.
- **Live rule.** Every MCP output is stamped with the latest match time it depends on (`t`/`t1` of the call; whole-match tools like `get_moments` count as unknown future and are only used to choose). A claim airing at `t` may only use numbers known by `t`, and its `asof` must be `<= t`.
- **Fact-check gate.** The fact-check gate always runs. Every number in a claim, and in any LLM-written text, must match a number seen in an MCP tool output (rounded to 0.1). Anything else is rejected and listed in the trace.
- **Localization guard.** If a localized line contains a number that is not in its claim's params or the tool outputs, it is replaced by the verified template line.

## What Azure needs to provide (`code/.env`)

| purpose | resource | env vars |
|---|---|---|
| agent LLM (option A) | Azure OpenAI resource with a chat deployment that supports tool calling, e.g. `gpt-4.1-mini` or `gpt-4o-mini` | `AZURE_OPENAI_ENDPOINT=https://<res>.openai.azure.com/`, `AZURE_OPENAI_DEPLOYMENT=<deployment name>`, `AZURE_OPENAI_API_KEY=<key>` (omit to use `DefaultAzureCredential`), `AZURE_OPENAI_API_VERSION=2024-10-21` |
| agent LLM (option B) | Azure AI Foundry project with a model deployment | `FOUNDRY_PROJECT_ENDPOINT=https://<res>.services.ai.azure.com/api/projects/<project>`, `FOUNDRY_MODEL=<deployment name>`, plus a credential for `DefaultAzureCredential`: `az login`, or `AZURE_CLIENT_ID` / `AZURE_TENANT_ID` / `AZURE_CLIENT_SECRET` |
| voice | Azure AI Speech resource (F0/S0) | `AZURE_SPEECH_KEY`, `AZURE_SPEECH_REGION` (voices: en-US-GuyNeural, es-ES-AlvaroNeural, tr-TR-AhmetNeural, de-DE-ConradNeural) |

The LLM path has only been tested against an unreachable endpoint (client builds, then the retry and fallback work), not against a real deployment yet.

## Story v4: commands, goal-moment voices, speech-to-text

```bash
$T/agentenv/bin/python crew.py --persona casual --lang en --window 63 72 --tag goal         # goal segment (also es --shortest, de, analyst en)
$T/ttsenv/bin/python voice.py ../data/match.*.goal.commentary.json                         # -> data/audio/<run>/{000.mp3,…,voice.json}
$T/ttsenv/bin/python voice.py --commands --ambience                                        # viewer commands, crowd loop + goal roar
$T/ttsenv/bin/python transcribe.py ../data/audio/commands/{1..9}.mp3 && $T/agentenv/bin/python command.py
```

- **`command.py`:** turns an instruction into calls to `seek`, `set_view`, `fork_what_if`, `set_persona`, `set_language`, `set_commentary_level` and `highlight_players`, plus director cues.
  - **Modes:** with Azure creds it runs an LLM `Agent` with these tools. Without them it uses a keyword/regex intent router, labelled `mode: "rules"` in every output.
  - **Data:** names, fork results and scores come from the MCP server (`get_roster`, `list_forks`, `compare_fork`, `get_match_state`).
- **`voice.py`:** the engine is ElevenLabs if `ELEVENLABS_API_KEY` is set, else Azure AI Speech, else Piper.
  - **Cache:** ElevenLabs requests are cached on disk (`.tools/el-cache`), so re-runs are free.
  - **Overlap:** a line that would talk over the next one is tightened locally with `atempo`.
- **`transcribe.py`:** faster-whisper `small` with the roster as vocabulary. It writes `data/commands/transcripts.json`, which `command.py` uses instead of the script.

**Voices and sound: ElevenLabs (elevenlabs.io).** Licences are in `web/public/assets/LICENSES.md`.
