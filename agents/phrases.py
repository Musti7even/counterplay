"""Template phrases for the fallback (no-LLM) path, per language. A claim of kind K with params P
renders as caption (title, text) and a commentary line made of the `say` sentences whose
params are all present. Templates add no numbers of their own: every number comes from a
verified tool output."""

TWEAK = {
    'en': {'step_up': 'stepped up', 'hold_line': 'held the line', 'sprint': 'made the run',
           'pass_early': 'played the pass early', 'shoot': 'shot early'},
    'es': {'step_up': 'hubiera adelantado la línea', 'hold_line': 'hubiera aguantado la línea',
           'sprint': 'hubiera hecho el desmarque', 'pass_early': 'hubiera soltado el pase antes',
           'shoot': 'hubiera disparado antes'},
    'tr': {'step_up': 'öne çıksaydı', 'hold_line': 'çizgiyi korusaydı', 'sprint': 'depar atsaydı',
           'pass_early': 'pası erken verseydi', 'shoot': 'erken şut çekseydi'},
    'de': {'step_up': 'herausgerückt wäre', 'hold_line': 'die Linie gehalten hätte',
           'sprint': 'den Lauf gemacht hätte', 'pass_early': 'den Pass früher gespielt hätte',
           'shoot': 'früher geschossen hätte'},
}

P = {
    'en': {
        'goal': ('GOAL', '{player} scores for {team}', ['GOAL! {player} finishes it for {team}, {score}.', 'Chance quality: xG {xg}.']),
        'big_chance': ('BIG CHANCE', '{player} from {dist} m', ['{player} lets fly from {dist} metres at {kmh} km/h.', 'xG {xg}.']),
        'line_breaking_pass': ('LINE-BREAKER', '{player} takes out {n}', ['{player} takes {n} opponents out of the game with a {dist} metre pass.']),
        'pressing_spell': ('PRESS', '{team} swarm the ball', ['{team} swarm the ball: {p} players around it on average.']),
        'momentum_swing': ('MOMENTUM', 'Swinging to {team}', ['The momentum swings to {team}.', 'Index {a} to {b}.']),
        'sprint_milestone': ('TOP SPEED', '{player}: {kmh} km/h', ['{player} hits {kmh} km/h.']),
        'tactic_control': ('CONTROL', '{team}: {poss}% possession', ['{team} have {poss} percent of the ball in this spell, control index {control}.']),
        'tactic_chaos': ('CHAOS', '{turnovers} turnovers', ['This is chaos: {turnovers} turnovers, chaos index {chaos}.']),
        'tactic_line': ('DEFENSIVE LINE', '{team}: {lh} m', ['{team} hold their line {lh} metres from their own goal.']),
        'whatif_setup': ('WHAT IF', '{player} {tweak}', ['What if {player} {tweak}?']),
        'whatif_prevented': ('RESULT', 'No goal: {base} becomes {fork}', ['In the what-if, the goal at {t} seconds never happens: {base} becomes {fork}.']),
        'whatif_created': ('RESULT', 'New goal for {team}', ['In the what-if, {team} score instead: {base} becomes {fork}.']),
        'whatif_nochange': ('RESULT', 'Same score: {fork}', ['Even in the what-if, the score stays {fork}.']),
        'player_load': ('PLAYER', '{player}', ['{player}: {dist} metres covered, top speed {kmh} km/h, {sprints} sprints.', 'Synthetic heart rate peaks at {hr}.']),
    },
    'es': {
        'goal': ('GOL', '{player} marca para {team}', ['¡GOL! {player} la manda dentro para {team}, {score}.', 'Calidad de la ocasión: xG {xg}.']),
        'big_chance': ('OCASIÓN CLARA', '{player} desde {dist} m', ['{player} dispara desde {dist} metros a {kmh} km/h.', 'xG {xg}.']),
        'line_breaking_pass': ('PASE QUE ROMPE LÍNEAS', '{player} elimina a {n}', ['{player} deja fuera a {n} rivales con un pase de {dist} metros.']),
        'pressing_spell': ('PRESIÓN', '{team} aprieta', ['{team} se lanza a por el balón: {p} jugadores alrededor de media.']),
        'momentum_swing': ('MOMENTUM', 'El dominio pasa a {team}', ['El dominio cambia de lado: ahora manda {team}.', 'Índice de {a} a {b}.']),
        'sprint_milestone': ('VELOCIDAD PUNTA', '{player}: {kmh} km/h', ['{player} alcanza {kmh} km/h.']),
        'tactic_control': ('CONTROL', '{team}: {poss}% de posesión', ['{team} tiene el {poss} por ciento del balón en esta fase, índice de control {control}.']),
        'tactic_chaos': ('CAOS', '{turnovers} pérdidas', ['Esto es un caos: {turnovers} pérdidas, índice de caos {chaos}.']),
        'tactic_line': ('LÍNEA DEFENSIVA', '{team}: {lh} m', ['{team} defiende con la línea a {lh} metros de su portería.']),
        'whatif_setup': ('¿Y SI...?', '{player} {tweak}', ['¿Y si {player} {tweak}?']),
        'whatif_prevented': ('RESULTADO', 'Sin gol: {base} pasa a {fork}', ['En la alternativa, el gol del segundo {t} nunca llega: {base} pasa a {fork}.']),
        'whatif_created': ('RESULTADO', 'Nuevo gol de {team}', ['En la alternativa marca {team}: {base} pasa a {fork}.']),
        'whatif_nochange': ('RESULTADO', 'Mismo marcador: {fork}', ['Ni siquiera en la alternativa cambia el marcador: {fork}.']),
        'player_load': ('JUGADOR', '{player}', ['{player}: {dist} metros recorridos, punta de {kmh} km/h, {sprints} esprints.', 'Pulso sintético máximo de {hr}.']),
    },
    'tr': {
        'goal': ('GOL', '{player} ile {team} golü buldu', ['GOL! {player} topu ağlara gönderiyor, {team} için skor {score}.', 'Pozisyonun gol beklentisi: xG {xg}.']),
        'big_chance': ('BÜYÜK FIRSAT', '{player}, {dist} metreden', ['{player} {dist} metreden vuruyor, top saatte {kmh} kilometre hızla gidiyor.', 'xG {xg}.']),
        'line_breaking_pass': ('HAT KIRAN PAS', '{player}: {n} rakip devre dışı', ['{player} {dist} metrelik pasla {n} rakibi oyun dışı bırakıyor.']),
        'pressing_spell': ('PRES', '{team} baskıda', ['{team} topa yükleniyor: ortalama {p} oyuncu topun hemen yanında.']),
        'momentum_swing': ('MOMENTUM', 'Üstünlük {team} tarafına geçiyor', ['Oyunun dengesi değişiyor, üstünlük artık {team} tarafında.', 'Endeks {a} seviyesinden {b} seviyesine.']),
        'sprint_milestone': ('SÜRAT', '{player}: {kmh} km/sa', ['{player} saatte {kmh} kilometreye ulaşıyor.']),
        'tactic_control': ('KONTROL', '{team}: %{poss} topla oynama', ['{team} bu bölümde topun yüzde {poss} kadarına sahip, kontrol endeksi {control}.']),
        'tactic_chaos': ('KAOS', '{turnovers} top kaybı', ['Oyun kaosa dönüyor: {turnovers} top kaybı, kaos endeksi {chaos}.']),
        'tactic_line': ('SAVUNMA ÇİZGİSİ', '{team}: {lh} m', ['{team} savunma çizgisini kendi kalesinden {lh} metre önde tutuyor.']),
        'whatif_setup': ('YA OLSAYDI?', '{player} {tweak}', ['Peki ya {player} {tweak}?']),
        'whatif_prevented': ('SONUÇ', 'Gol yok: {base} yerine {fork}', ['Alternatif senaryoda {t}. saniyedeki gol hiç gelmiyor: {base} yerine skor {fork}.']),
        'whatif_created': ('SONUÇ', 'Yeni gol: {team}', ['Alternatif senaryoda golü {team} buluyor: {base} yerine skor {fork}.']),
        'whatif_nochange': ('SONUÇ', 'Skor değişmiyor: {fork}', ['Alternatif senaryoda da skor değişmiyor: {fork}.']),
        'player_load': ('OYUNCU', '{player}', ['{player}: {dist} metre koşu, en yüksek hız saatte {kmh} kilometre, {sprints} sprint.', 'Sentetik nabız en fazla {hr}.']),
    },
    'de': {
        'goal': ('TOR', '{player} trifft für {team}', ['TOR! {player} vollendet für {team}, {score}.', 'Chancenqualität: xG {xg}.']),
        'big_chance': ('GROSSCHANCE', '{player} aus {dist} m', ['{player} zieht aus {dist} Metern ab, mit {kmh} km/h.', 'xG {xg}.']),
        'line_breaking_pass': ('LINIENBRECHER', '{player} überspielt {n}', ['{player} überspielt mit einem {dist}-Meter-Pass {n} Gegenspieler.']),
        'pressing_spell': ('PRESSING', '{team} attackiert den Ball', ['{team} läuft an: im Schnitt {p} Spieler am Ball.']),
        'momentum_swing': ('MOMENTUM', 'Kippt zu {team}', ['Das Momentum kippt zu {team}.', 'Index von {a} auf {b}.']),
        'sprint_milestone': ('TOPSPEED', '{player}: {kmh} km/h', ['{player} erreicht {kmh} km/h.']),
        'tactic_control': ('KONTROLLE', '{team}: {poss}% Ballbesitz', ['{team} hat in dieser Phase {poss} Prozent Ballbesitz, Kontrollindex {control}.']),
        'tactic_chaos': ('CHAOS', '{turnovers} Ballverluste', ['Das ist Chaos: {turnovers} Ballverluste, Chaosindex {chaos}.']),
        'tactic_line': ('ABWEHRLINIE', '{team}: {lh} m', ['{team} verteidigt {lh} Meter vor dem eigenen Tor.']),
        'whatif_setup': ('WAS WÄRE, WENN', '{player} {tweak}', ['Was wäre, wenn {player} {tweak}?']),
        'whatif_prevented': ('ERGEBNIS', 'Kein Tor: {base} wird {fork}', ['Im Was-wäre-wenn fällt das Tor nach {t} Sekunden nie: aus {base} wird {fork}.']),
        'whatif_created': ('ERGEBNIS', 'Neues Tor für {team}', ['Im Was-wäre-wenn trifft stattdessen {team}: aus {base} wird {fork}.']),
        'whatif_nochange': ('ERGEBNIS', 'Gleicher Stand: {fork}', ['Auch im Was-wäre-wenn bleibt es beim {fork}.']),
        'player_load': ('SPIELER', '{player}', ['{player}: {dist} Meter Laufweg, Topspeed {kmh} km/h, {sprints} Sprints.', 'Synthetischer Puls bis {hr}.']),
    },
}
LANGS = tuple(P)


def render(kind, params, lang):
    """-> (caption_title, caption_text, line) or None if the kind has no template."""
    t = P.get(lang, P['en']).get(kind)
    if not t:
        return None
    ps = {k: int(v) if isinstance(v, float) and v.is_integer() else v for k, v in params.items()}  # 100.0 -> 100
    if 'tweak' in ps:
        ps['tweak'] = TWEAK.get(lang, TWEAK['en']).get(ps['tweak'], ps['tweak'])
    ok = lambda s: all(ps.get(k) is not None for k in _fields(s))
    say = ' '.join(s.format(**ps) for s in t[2] if ok(s))
    cap = t[1].format(**ps) if ok(t[1]) else ''
    return t[0], cap, say


def _fields(s):
    import string
    return [f for _, f, _, _ in string.Formatter().parse(s) if f]
