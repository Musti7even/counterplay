"""Broadcast phrases for the template (no-LLM) path, per language and voice.

Voices: 'casual' (emotion + story, short, few numbers), 'analyst' (precise, numbers with meaning),
'you' (player persona, second person to that player). Missing entries fall back you -> analyst
-> casual. A template line is made of the sentences whose params are all present.
Templates contain no literal numbers: every number comes from a verified claim param, and the
casual voice (and 'you' for values >= 10) rounds floats to whole numbers (the fact-checker accepts tool numbers rounded).
"""
import string

W = {  # word buckets derived from params, so casual lines can carry meaning without numbers
    'en': {'xgw': [(0.12, 'a speculative effort'), (0.2, 'a half-chance'), (0.35, 'a good chance'), (9, 'a big chance')],
           'ctlw': [(40, 'pure chaos'), (60, 'a scrappy spell'), (101, 'composed, patient possession')]},
    'es': {'xgw': [(0.12, 'un disparo a la desesperada'), (0.2, 'media ocasión'), (0.35, 'una buena ocasión'), (9, 'una ocasión clarísima')],
           'ctlw': [(40, 'puro caos'), (60, 'una fase muy rota'), (101, 'posesión pausada y con criterio')]},
    'tr': {'xgw': [(0.12, 'umutsuz bir deneme'), (0.2, 'yarım bir pozisyon'), (0.35, 'iyi bir pozisyon'), (9, 'net bir pozisyon')],
           'ctlw': [(40, 'tam bir kaos'), (60, 'kopuk bir bölüm'), (101, 'sabırlı, kontrollü bir oyun')]},
    'de': {'xgw': [(0.12, 'ein Verzweiflungsschuss'), (0.2, 'eine Halbchance'), (0.35, 'eine gute Chance'), (9, 'eine Riesenchance')],
           'ctlw': [(40, 'reines Chaos'), (60, 'eine zerfahrene Phase'), (101, 'ruhiger, kontrollierter Ballbesitz')]},
}

TWEAK = {  # past conditional for "what if X had ...", plus 'you' and present-tense analyst forms
    'en': {'casual': {'step_up': 'stepped up', 'hold_line': 'held the line', 'sprint': 'made that run',
                      'pass_early': 'released it earlier', 'shoot': 'shot first time'},
           'analyst': {'step_up': 'steps up instead of dropping off', 'hold_line': 'holds the line instead of dropping',
                       'sprint': 'makes the forward run', 'pass_early': 'releases the pass a beat earlier', 'shoot': 'shoots first time'}},
    'es': {'casual': {'step_up': 'hubiera salido a presionar', 'hold_line': 'hubiera aguantado la línea', 'sprint': 'hubiera atacado el espacio',
                      'pass_early': 'hubiera soltado el pase antes', 'shoot': 'hubiera disparado a la primera'},
           'analyst': {'step_up': 'adelanta su posición en lugar de recular', 'hold_line': 'mantiene la línea en lugar de recular',
                       'sprint': 'ataca el espacio', 'pass_early': 'suelta el pase un tiempo antes', 'shoot': 'dispara a la primera'}},
    'tr': {'casual': {'step_up': 'öne çıksaydı', 'hold_line': 'çizgiyi korusaydı', 'sprint': 'o koşuyu yapsaydı',
                      'pass_early': 'pası daha erken verseydi', 'shoot': 'ilk vuruşta şut çekseydi'},
           'analyst': {'step_up': 'geri çekilmek yerine öne çıkıyor', 'hold_line': 'geri çekilmek yerine çizgiyi koruyor',
                       'sprint': 'boş alana koşuyor', 'pass_early': 'pası bir an erken veriyor', 'shoot': 'ilk vuruşta şut çekiyor'}},
    'de': {'casual': {'step_up': 'herausgerückt wäre', 'hold_line': 'die Linie gehalten hätte', 'sprint': 'den Lauf gemacht hätte',
                      'pass_early': 'den Ball früher gespielt hätte', 'shoot': 'direkt abgezogen hätte'},
           'analyst': {'step_up': 'rückt heraus, statt sich fallen zu lassen', 'hold_line': 'hält die Linie, statt sich fallen zu lassen',
                       'sprint': 'startet in die Tiefe', 'pass_early': 'spielt den Pass einen Tick früher', 'shoot': 'zieht direkt ab'}},
}
ROLE = {  # positions as spoken in each language
    'en': {'GK': 'goalkeeper', 'CB': 'centre-back', 'LB': 'left-back', 'RB': 'right-back', 'CM': 'central midfield',
           'LM': 'left midfield', 'RM': 'right midfield', 'CF': 'centre-forward'},
    'es': {'GK': 'portero', 'CB': 'central', 'LB': 'lateral izquierdo', 'RB': 'lateral derecho', 'CM': 'mediocentro',
           'LM': 'interior izquierdo', 'RM': 'interior derecho', 'CF': 'delantero centro'},
    'tr': {'GK': 'kaleci', 'CB': 'stoper', 'LB': 'sol bek', 'RB': 'sağ bek', 'CM': 'merkez orta saha',
           'LM': 'sol kanat', 'RM': 'sağ kanat', 'CF': 'santrfor'},
    'de': {'GK': 'Torwart', 'CB': 'Innenverteidiger', 'LB': 'Linksverteidiger', 'RB': 'Rechtsverteidiger', 'CM': 'zentraler Mittelfeldspieler',
           'LM': 'linker Mittelfeldspieler', 'RM': 'rechter Mittelfeldspieler', 'CF': 'Mittelstürmer'},
}
YOU_TWEAK = {
    'en': {'step_up': 'stepped up', 'hold_line': 'held your line', 'sprint': 'made that run', 'pass_early': 'played it earlier', 'shoot': 'shot first time'},
    'es': {'step_up': 'hubieras salido', 'hold_line': 'hubieras aguantado la línea', 'sprint': 'hubieras hecho ese desmarque',
           'pass_early': 'la hubieras soltado antes', 'shoot': 'hubieras disparado a la primera'},
    'tr': {'step_up': 'öne çıksaydın', 'hold_line': 'çizgini korusaydın', 'sprint': 'o koşuyu yapsaydın',
           'pass_early': 'pası erken verseydin', 'shoot': 'ilk vuruşta vursaydın'},
    'de': {'step_up': 'herausgerückt wärst', 'hold_line': 'die Linie gehalten hättest', 'sprint': 'den Lauf gemacht hättest',
           'pass_early': 'früher abgespielt hättest', 'shoot': 'direkt abgezogen hättest'},
}

P = {
    'en': {
        'casual': {
            'goal': ('GOAL!', '{player} · {team}', [['GOAL! {player} buries it!', '{team} make it {score}.'],
                                                    ['And there it is again! {player} with another!', '{score} to {team} now.']]),
            'big_chance': ('SO CLOSE', '{player} from {dist} m', [['{player} lets fly from {dist} metres...', 'so close for {team}!'],
                                                                  ['{player} has a go from {dist} metres!', 'Inches away. {team} will be kicking themselves.'],
                                                                  ['Another sight of goal for {player}, {dist} metres out...', 'not this time! {team} keep searching.']]),
            'line_breaking_pass': ('WHAT A BALL', '{player} cuts through', ['What a ball from {player}!', '{n} defenders gone with one pass.']),
            'pressing_spell': ('THE PRESS', '{team} hunt in packs', ['{team} are hunting in packs now, nobody gets a second on the ball.']),
            'momentum_swing': ('MOMENTUM', 'The tide turns', ['And the tide is turning. {team} are on top now.']),
            'sprint_milestone': ('FLAT OUT', '{player} · {kmh} km/h', ['Look at {player} go! {kmh} km/h, flat out.']),
            'tactic_siege': ('ALL {team}', '{opp} can\'t get out', [['{team} have camped in {opp}\'s half. {opp} simply can\'t get a touch.'],
                                                                     ['It\'s all {team} now. {opp} are chasing shadows.'],
                                                                     ['{team} are knocking on the door again, {opp} pinned in their own box.']]),
            'tactic_control': ('PATIENCE', '{team} keep the ball', ['{team} are keeping the ball, patient, probing for the opening.']),
            'tactic_chaos': ('END TO END', 'Nobody can keep it', ['It\'s end to end now, nobody can keep hold of the ball!']),
            'tactic_line': ('DEEP BLOCK', '{team} sit deep', ['{team} are sitting deep and inviting the pressure.']),
            'whatif_setup': ('WHAT IF?', '{player} {tweak}', ['Now hold on. What if {player} had {tweak}?']),
            'whatif_prevented': ('WHAT IF', 'No goal!', ['Same moment, one change, and no goal!', 'It\'s {fork}, not {base}.']),
            'whatif_created': ('WHAT IF', '{team} score!', ['One change, and suddenly {team} score!', 'It\'s {fork}, not {base}.']),
            'whatif_nochange': ('WHAT IF', 'Same story', ['Different choice, same story: still {fork}.']),
            'player_load': ('WORKHORSE', '{player}', ['{player} has run {dist} metres so far and touched {kmh} km/h. What an engine.']),
        },
        'analyst': {
            'goal': ('GOAL', '{player} · xG {xg}', ['Goal, {player}, from {dist} metres.', 'xG {xg}: {xgw}, and he takes it.', '{score}.']),
            'big_chance': ('CHANCE', '{player} · xG {xg}', [['{player} from {dist} metres at {kmh} km/h, xG {xg}.', 'That is {xgw} for {team}.'],
                                                            ['{player} again: {dist} metres, {kmh} km/h.', 'xG {xg}, {xgw}, and it stays out.'],
                                                            ['{player} gets the shot away from {dist} metres, xG {xg}.', 'The volume of chances is building for {team}.']]),
            'line_breaking_pass': ('LINE-BREAKER', '{n} opponents bypassed', ['{player} breaks the lines: one {dist} metre pass, {n} opponents bypassed.', 'That is how you beat a block.']),
            'pressing_spell': ('PRESSING', '{team} · {p} near the ball', ['{team} press with {p} players near the ball on average.', 'That is a coordinated trap, not individual chasing.']),
            'momentum_swing': ('MOMENTUM', '{a} to {b}', ['Momentum index from {a} to {b}: {team} now own the ball and the territory.']),
            'sprint_milestone': ('TOP SPEED', '{player} · {kmh} km/h', ['{player} tops out at {kmh} km/h, his team\'s quickest run so far.']),
            'tactic_siege': ('TERRITORY', '{team} · {poss}%', [['{team} with {poss} percent of the ball in this phase.', '{opp} are pinned back and cannot build.'],
                                                              ['{poss} percent possession for {team} in the build-up.', '{opp} are defending their box, not the space.']]),
            'tactic_control': ('CONTROL', 'Control index {control}', ['{team} have {poss} percent of the ball here, control index {control}: {ctlw}.']),
            'tactic_chaos': ('CHAOS', '{turnovers} turnovers', ['{turnovers} turnovers in this spell, chaos index {chaos}.', 'Nobody is controlling this game.']),
            'tactic_line': ('BACK LINE', '{team} · {lh} m', [['{team}\'s back line sits {lh} metres from their own goal.', 'That is the gap {who} runs into.'],
                                                            ['{team} defend {lh} metres from goal again.', 'Watch {who} find the pocket in front of them.']]),
            'whatif_setup': ('COUNTERFACTUAL', '{player} {tweak}', ['Counterfactual: same seed, same moment, but {player} {tweak}.']),
            'whatif_prevented': ('RESULT', '{base} vs {fork}', ['Result: no goal at {t} seconds in the what-if.', 'Right now it is {base} in the original and {fork} in the what-if.']),
            'whatif_created': ('RESULT', '{base} vs {fork}', ['Result: {team} score in the what-if.', 'At the same moment it is {base} in the original and {fork} in the what-if.']),
            'whatif_nochange': ('RESULT', '{fork}', ['Result: different movement, same scoreline, {fork}.']),
            'player_load': ('LOAD', '{player}', ['{player} so far: {dist} metres covered, top speed {kmh} km/h, {sprints} sprints.', 'Synthetic heart rate peak so far {hr}.']),
        },
        'you': {
            'you_job': ('YOUR JOB', '{pos} · line at {lh} m', ['You start at {pos} tonight, {player}.', 'Your back line sets up {lh} metres from goal, and {near} is the nearest opponent to you.']),
            'you_tackle': ('DUEL WON', 'You stop {other}', ['Big tackle from you, ball won off {other}.']),
            'you_intercept': ('INTERCEPTION', 'You read it', ['You read the pass and step in. Ball won.']),
            'you_beaten': ('DUEL LOST', '{other} gets the ball', ['{other} wins that one and takes the ball off you.']),
            'you_goal_against': ('GOAL AGAINST', '{scorer} · {score}', ['{scorer} scores, {score}.', '{near} was {near_d} metres from you when the shot came.', 'You were {behind} metres deeper than the rest of your line.', 'You were {ahead} metres ahead of the rest of your line.']),
            'you_goal_for': ('GOAL!', '{scorer} · {score}', ['{scorer} scores for your side, {score}!']),
            'whatif_setup': ('YOUR WHAT IF', 'What if you {tweak}?', ['This one is on you, {player}. What if you had {tweak}?']),
            'whatif_prevented': ('YOUR WHAT IF', 'No goal: {fork}', ['You step up, and there is no goal at {t} seconds.', 'It is {fork}, not {base}.']),
            'sprint_milestone': ('YOUR TOP SPEED', '{kmh} km/h', ['That is you at {kmh} km/h, your fastest run so far.']),
            'player_load': ('YOUR MATCH', '{dist} m · {kmh} km/h', ['So far you have covered {dist} metres, topped out at {kmh} km/h and made {sprints} sprints.', 'Your synthetic heart rate has peaked at {hr}.']),
        },
    },
    'es': {
        'casual': {
            'goal': ('¡GOL!', '{player} · {team}', [['¡GOOOL! ¡{player} la manda a la red!', '{team} pone el {score}.'],
                                                    ['¡Y otra vez! ¡{player} vuelve a marcar!', '{score} para {team}.']]),
            'big_chance': ('¡CASI!', '{player} desde {dist} m', [['{player} se la juega desde {dist} metros...', '¡casi para {team}!'],
                                                                 ['¡{player} lo intenta desde {dist} metros!', '¡Por muy poco! {team} se lamenta.'],
                                                                 ['Otra vez {player}, desde {dist} metros...', '¡y no entra! {team} sigue insistiendo.']]),
            'line_breaking_pass': ('¡QUÉ PASE!', '{player} rompe líneas', ['¡Qué pase de {player}!', 'Deja atrás a {n} rivales de un plumazo.']),
            'pressing_spell': ('PRESIÓN', '{team} muerde', ['{team} muerde arriba, nadie tiene un segundo para pensar.']),
            'momentum_swing': ('CAMBIO DE GUION', 'El partido gira', ['El partido cambia de dueño: ahora manda {team}.']),
            'sprint_milestone': ('A TODA MÁQUINA', '{player} · {kmh} km/h', ['¡Mira cómo corre {player}! {kmh} km/h, a tope.']),
            'tactic_siege': ('ACOSO', '{opp} no sale', [['{team} se ha instalado en campo del {opp}, que no consigue ni tocarla.'],
                                                        ['Ahora solo juega {team}. {opp} persigue sombras.'],
                                                        ['{team} vuelve a llamar a la puerta, {opp} encerrado en su área.']]),
            'tactic_control': ('PACIENCIA', '{team} la mueve', ['{team} mueve el balón con paciencia, buscando el hueco.']),
            'tactic_chaos': ('IDA Y VUELTA', 'Nadie la retiene', ['¡Esto es un ida y vuelta, nadie es capaz de retener el balón!']),
            'tactic_line': ('BLOQUE BAJO', '{team} se encierra', ['{team} se encierra atrás y espera.']),
            'whatif_setup': ('¿Y SI...?', '{player} {tweak}', ['Un momento. ¿Y si {player} {tweak}?']),
            'whatif_prevented': ('¿Y SI...?', '¡Sin gol!', ['Mismo instante, un solo cambio, ¡y no hay gol!', '{fork} en lugar de {base}.']),
            'whatif_created': ('¿Y SI...?', '¡Marca {team}!', ['Un solo cambio ¡y marca {team}!', '{fork} en lugar de {base}.']),
            'whatif_nochange': ('¿Y SI...?', 'La misma historia', ['Otra decisión, la misma historia: sigue {fork}.']),
            'player_load': ('PULMÓN', '{player}', ['{player} lleva ya {dist} metros y ha tocado los {kmh} km/h. Qué despliegue.']),
        },
        'analyst': {
            'goal': ('GOL', '{player} · xG {xg}', ['Gol de {player} desde {dist} metros.', 'xG {xg}: {xgw}, y no perdona.', '{score}.']),
            'big_chance': ('OCASIÓN', '{player} · xG {xg}', [['{player} desde {dist} metros a {kmh} km/h, xG {xg}.', 'Es {xgw} para {team}.'],
                                                             ['Otra vez {player}: {dist} metros, {kmh} km/h.', 'xG {xg}, {xgw}, y no entra.'],
                                                             ['{player} dispara desde {dist} metros, xG {xg}.', 'Las ocasiones de {team} se acumulan.']]),
            'line_breaking_pass': ('PASE ENTRE LÍNEAS', '{n} rivales superados', ['{player} rompe líneas: un pase de {dist} metros y {n} rivales superados.', 'Así se desarma un bloque.']),
            'pressing_spell': ('PRESIÓN', '{team} · {p} junto al balón', ['{team} presiona con {p} jugadores cerca del balón de media.', 'Es una trampa coordinada, no persecución individual.']),
            'momentum_swing': ('MOMENTUM', 'De {a} a {b}', ['El índice de momentum pasa de {a} a {b}: {team} domina balón y territorio.']),
            'sprint_milestone': ('PUNTA', '{player} · {kmh} km/h', ['{player} llega a {kmh} km/h, la carrera más rápida de su equipo hasta ahora.']),
            'tactic_siege': ('TERRITORIO', '{team} · {poss}%', [['{team} tiene el {poss} por ciento del balón en esta fase.', '{opp} está hundido y no puede construir.'],
                                                               ['{poss} por ciento de posesión para {team} en la elaboración.', '{opp} defiende el área, no el espacio.']]),
            'tactic_control': ('CONTROL', 'Índice {control}', ['{team} tiene el {poss} por ciento del balón, índice de control {control}: {ctlw}.']),
            'tactic_chaos': ('CAOS', '{turnovers} pérdidas', ['{turnovers} pérdidas en esta fase, índice de caos {chaos}.', 'Nadie controla el partido.']),
            'tactic_line': ('LÍNEA DEFENSIVA', '{team} · {lh} m', [['La línea defensiva de {team} está a {lh} metros de su portería.', 'Ese es el espacio que ataca {who}.'],
                                                                  ['{team} vuelve a defender a {lh} metros de su portería.', 'Fíjense en cómo {who} encuentra el hueco por delante.']]),
            'whatif_setup': ('CONTRAFACTUAL', '{player} {tweak}', ['Contrafactual: misma semilla, mismo instante, pero {player} {tweak}.']),
            'whatif_prevented': ('RESULTADO', '{base} vs {fork}', ['Resultado: en la alternativa no hay gol en el segundo {t}.', 'Ahora mismo, {base} en el original y {fork} en la alternativa.']),
            'whatif_created': ('RESULTADO', '{base} vs {fork}', ['Resultado: en la alternativa marca {team}.', 'En el mismo instante, {base} en el original y {fork} en la alternativa.']),
            'whatif_nochange': ('RESULTADO', '{fork}', ['Resultado: otro movimiento, mismo marcador, {fork}.']),
            'player_load': ('CARGA', '{player}', ['{player} hasta ahora: {dist} metros recorridos, punta de {kmh} km/h, {sprints} esprints.', 'Pulso sintético máximo hasta ahora: {hr}.']),
        },
        'you': {
            'you_job': ('TU TAREA', '{pos} · línea a {lh} m', ['Hoy arrancas como {pos}, {player}.', 'Tu línea se coloca a {lh} metros de la portería y {near} es el rival más cercano.']),
            'you_tackle': ('DUELO GANADO', 'Frenas a {other}', ['Gran entrada tuya, le robas el balón a {other}.']),
            'you_intercept': ('INTERCEPCIÓN', 'Lo lees', ['Lees el pase y te anticipas. Balón recuperado.']),
            'you_beaten': ('DUELO PERDIDO', '{other} se impone', ['{other} gana ese duelo y te quita el balón.']),
            'you_goal_against': ('GOL EN CONTRA', '{scorer} · {score}', ['Marca {scorer}, {score}.', '{near} estaba a {near_d} metros de ti en el disparo.', 'Estabas {behind} metros por detrás del resto de tu línea.', 'Estabas {ahead} metros por delante del resto de tu línea.']),
            'you_goal_for': ('¡GOL!', '{scorer} · {score}', ['¡Marca {scorer} para tu equipo, {score}!']),
            'whatif_setup': ('TU ¿Y SI...?', '¿Y si {tweak}?', ['Esta va por ti, {player}. ¿Y si {tweak}?']),
            'whatif_prevented': ('TU ¿Y SI...?', 'Sin gol: {fork}', ['Sales tú, y no hay gol en el segundo {t}.', '{fork} en lugar de {base}.']),
            'sprint_milestone': ('TU PUNTA', '{kmh} km/h', ['Ese eres tú a {kmh} km/h, tu carrera más rápida hasta ahora.']),
            'player_load': ('TU PARTIDO', '{dist} m · {kmh} km/h', ['Llevas {dist} metros, punta de {kmh} km/h y {sprints} esprints.', 'Tu pulso sintético ha llegado a {hr}.']),
        },
    },
    'tr': {
        'casual': {
            'goal': ('GOL!', '{player} · {team}', [['GOOL! {player} topu ağlara gömüyor!', 'Skor {score}, {team} sevinçli.'],
                                                   ['Bir gol daha! {player} yine sahnede!', 'Skor artık {score}.']]),
            'big_chance': ('KIL PAYI', '{player}, {dist} metreden', [['{player} {dist} metreden vurdu...', 'kıl payı, {team} için çok yakındı!'],
                                                                     ['{player} {dist} metreden şansını deniyor!', 'Olmadı! {team} için büyük fırsat kaçtı.'],
                                                                     ['Yine {player}, {dist} metreden...', 've gol değil! {team} zorlamaya devam ediyor.']]),
            'line_breaking_pass': ('NE PAS!', '{player} hattı yardı', ['{player} ne pas attı!', 'Tek pasla {n} rakip birden oyun dışı.']),
            'pressing_spell': ('PRES', '{team} boğuyor', ['{team} rakibi boğuyor, kimseye nefes aldırmıyor.']),
            'momentum_swing': ('DENGE DEĞİŞTİ', 'Rüzgar döndü', ['Rüzgar döndü, artık oyunun hakimi {team}.']),
            'sprint_milestone': ('TAM GAZ', '{player} · {kmh} km/sa', ['Şu {player} ye bakın! Saatte {kmh} kilometre, tam gaz.']),
            'tactic_siege': ('TEK KALE', '{opp} çıkamıyor', [['{team} rakip yarı sahaya yerleşti, {opp} topa dokunamıyor.'],
                                                             ['Sahada artık sadece {team} var. {opp} gölge kovalıyor.'],
                                                             ['{team} yine kapıyı çalıyor, {opp} kendi ceza sahasına gömülmüş.']]),
            'tactic_control': ('SABIR', '{team} topu tutuyor', ['{team} topu sabırla çeviriyor, boşluğu kolluyor.']),
            'tactic_chaos': ('KARŞILIKLI AKINLAR', 'Kimse topu tutamıyor', ['Karşılıklı akınlar, kimse topu ayağında tutamıyor!']),
            'tactic_line': ('GERİDE BLOK', '{team} geride', ['{team} geriye yaslanmış, baskıyı karşılıyor.']),
            'whatif_setup': ('YA OLSAYDI?', '{player} {tweak}', ['Bir dakika. Peki ya {player} {tweak}?']),
            'whatif_prevented': ('YA OLSAYDI?', 'Gol yok!', ['Aynı an, tek bir değişiklik ve gol yok!', 'Skor {base} değil, {fork}.']),
            'whatif_created': ('YA OLSAYDI?', 'Gol {team} tarafından!', ['Tek bir değişiklik, ve golü {team} atıyor!', 'Skor {base} değil, {fork}.']),
            'whatif_nochange': ('YA OLSAYDI?', 'Aynı hikaye', ['Başka bir karar, aynı hikaye: skor yine {fork}.']),
            'player_load': ('MOTOR', '{player}', ['{player} şimdiden {dist} metre koştu, saatte {kmh} kilometreyi gördü. Ne motor!']),
        },
        'analyst': {
            'goal': ('GOL', '{player} · xG {xg}', ['Gol {player} imzalı, {dist} metreden.', 'xG {xg}: {xgw}, ve affetmiyor.', 'Skor {score}.']),
            'big_chance': ('POZİSYON', '{player} · xG {xg}', [['{player} {dist} metreden, saatte {kmh} kilometre, xG {xg}.', '{team} için {xgw}.'],
                                                              ['Yine {player}: {dist} metre, saatte {kmh} kilometre.', 'xG {xg}, {xgw}, ama gol çıkmıyor.'],
                                                              ['{player} {dist} metreden vuruşunu yapıyor, xG {xg}.', '{team} pozisyonları üst üste diziyor.']]),
            'line_breaking_pass': ('HAT KIRAN PAS', '{n} rakip geçildi', ['{player} hatları kırıyor: {dist} metrelik tek pas, {n} rakip geride kaldı.', 'Blok savunma böyle açılır.']),
            'pressing_spell': ('PRES', '{team} · topun yanında {p}', ['{team} ortalama {p} oyuncuyla topun yakınında pres yapıyor.', 'Bu tek tek kovalama değil, organize bir tuzak.']),
            'momentum_swing': ('MOMENTUM', '{a} → {b}', ['Momentum endeksi {a} seviyesinden {b} seviyesine: top da alan da artık {team} elinde.']),
            'sprint_milestone': ('SÜRAT', '{player} · {kmh} km/sa', ['{player} saatte {kmh} kilometreye çıkıyor, takımının şu ana kadarki en hızlı koşusu.']),
            'tactic_siege': ('ALAN HAKİMİYETİ', '{team} · %{poss}', [['{team} bu bölümde topun yüzde {poss} kadarına sahip.', '{opp} kendi yarı sahasına hapsolmuş, oyun kuramıyor.'],
                                                                     ['Oyun kurulumunda {team} topun yüzde {poss} kadarına sahip.', '{opp} alanı değil, ceza sahasını savunuyor.']]),
            'tactic_control': ('KONTROL', 'Kontrol endeksi {control}', ['{team} topun yüzde {poss} kadarına sahip, kontrol endeksi {control}: {ctlw}.']),
            'tactic_chaos': ('KAOS', '{turnovers} top kaybı', ['Bu bölümde {turnovers} top kaybı var, kaos endeksi {chaos}.', 'Oyunu kimse kontrol edemiyor.']),
            'tactic_line': ('SAVUNMA ÇİZGİSİ', '{team} · {lh} m', [['{team} savunma çizgisi kendi kalesinden {lh} metre önde.', '{who} tam o boşluğa koşuyor.'],
                                                                  ['{team} yine kalesinden {lh} metre önde savunuyor.', '{who} önündeki boşluğu buluyor, dikkat edin.']]),
            'whatif_setup': ('ALTERNATİF SENARYO', '{player} {tweak}', ['Alternatif senaryo: aynı tohum, aynı an, ama {player} {tweak}.']),
            'whatif_prevented': ('SONUÇ', '{base} / {fork}', ['Sonuç: alternatifte {t}. saniyede gol yok.', 'Şu anda orijinalde skor {base}, alternatifte {fork}.']),
            'whatif_created': ('SONUÇ', '{base} / {fork}', ['Sonuç: alternatifte golü {team} atıyor.', 'Aynı anda orijinalde skor {base}, alternatifte {fork}.']),
            'whatif_nochange': ('SONUÇ', '{fork}', ['Sonuç: farklı hareket, aynı skor, {fork}.']),
            'player_load': ('YÜK', '{player}', ['{player} şu ana kadar: {dist} metre koşu, en yüksek hız saatte {kmh} kilometre, {sprints} sprint.', 'Şu ana kadarki en yüksek sentetik nabız {hr}.']),
        },
        'you': {
            'you_job': ('GÖREVİN', '{pos} · hat {lh} m', ['Bu akşam {pos} olarak başlıyorsun, {player}.', 'Savunma hattın kalenden {lh} metre önde kuruluyor, sana en yakın rakip {near}.']),
            'you_tackle': ('İKİLİ MÜCADELE', '{other} durduruldu', ['Harika müdahale, topu {other} oyuncusundan alıyorsun.']),
            'you_intercept': ('TOP KAPTIN', 'Pası okudun', ['Pası okuyup araya giriyorsun. Top artık sizde.']),
            'you_beaten': ('MÜCADELE KAYBI', '{other} topu aldı', ['{other} bu mücadeleyi kazanıyor ve topu senden alıyor.']),
            'you_goal_against': ('YENİLEN GOL', '{scorer} · {score}', ['{scorer} golü atıyor, {score}.', 'Şut anında {near} senden {near_d} metre uzaktaydı.', 'Hattının geri kalanından {behind} metre daha gerideydin.', 'Hattının geri kalanından {ahead} metre daha öndeydin.']),
            'you_goal_for': ('GOL!', '{scorer} · {score}', ['{scorer} takımın için atıyor, {score}!']),
            'whatif_setup': ('SENİN SENARYON', 'Ya {tweak}?', ['Bu sefer mesele sensin, {player}. Peki ya {tweak}?']),
            'whatif_prevented': ('SENİN SENARYON', 'Gol yok: {fork}', ['Sen öne çıkıyorsun ve {t}. saniyede gol yok.', 'Skor {base} değil, {fork}.']),
            'sprint_milestone': ('EN YÜKSEK HIZIN', '{kmh} km/sa', ['Saatte {kmh} kilometre, şu ana kadarki en hızlı koşun bu.']),
            'player_load': ('SENİN MAÇIN', '{dist} m · {kmh} km/sa', ['Şu ana kadar {dist} metre koştun, saatte {kmh} kilometreyi gördün, {sprints} sprint attın.', 'Sentetik nabzın {hr} değerine kadar çıktı.']),
        },
    },
    'de': {
        'casual': {
            'goal': ('TOR!', '{player} · {team}', [['TOOOR! {player} versenkt ihn!', '{team} stellt auf {score}.'],
                                                   ['Und schon wieder! {player} schlägt erneut zu!', '{score} für {team}.']]),
            'big_chance': ('KNAPP!', '{player} aus {dist} m', [['{player} zieht aus {dist} Metern ab...', 'ganz knapp für {team}!'],
                                                               ['{player} versucht es aus {dist} Metern!', 'Haarscharf! Da hadert {team}.'],
                                                               ['Wieder {player}, aus {dist} Metern...', 'nicht drin! {team} bleibt dran.']]),
            'line_breaking_pass': ('WAS FÜR EIN PASS', '{player} spielt sie schwindlig', ['Was für ein Ball von {player}!', 'Mit einem Pass {n} Gegenspieler aus dem Spiel genommen.']),
            'pressing_spell': ('PRESSING', '{team} jagt im Rudel', ['{team} jagt jetzt im Rudel, keiner hat eine Sekunde Zeit am Ball.']),
            'momentum_swing': ('DAS SPIEL KIPPT', 'Jetzt {team}', ['Das Spiel kippt: jetzt hat {team} das Kommando.']),
            'sprint_milestone': ('VOLLGAS', '{player} · {kmh} km/h', ['Schauen Sie, wie {player} rennt! {kmh} km/h, Vollgas.']),
            'tactic_siege': ('POWERPLAY', '{opp} kommt nicht raus', [['{team} hat sich in der Hälfte von {opp} festgesetzt, {opp} kommt gar nicht mehr an den Ball.'],
                                                                     ['Nur noch {team}. {opp} läuft nur noch hinterher.'],
                                                                     ['{team} klopft schon wieder an, {opp} ist hinten eingeschnürt.']]),
            'tactic_control': ('GEDULD', '{team} lässt laufen', ['{team} lässt den Ball geduldig laufen und sucht die Lücke.']),
            'tactic_chaos': ('HIN UND HER', 'Keiner hält den Ball', ['Hin und her geht das jetzt, keiner kann den Ball halten!']),
            'tactic_line': ('TIEFER BLOCK', '{team} steht tief', ['{team} steht tief und lädt zum Angreifen ein.']),
            'whatif_setup': ('WAS WÄRE, WENN?', '{player} {tweak}', ['Moment mal. Was wäre, wenn {player} {tweak}?']),
            'whatif_prevented': ('WAS WÄRE, WENN', 'Kein Tor!', ['Gleicher Moment, eine Änderung, und kein Tor!', '{fork} statt {base}.']),
            'whatif_created': ('WAS WÄRE, WENN', '{team} trifft!', ['Eine Änderung, und plötzlich trifft {team}!', '{fork} statt {base}.']),
            'whatif_nochange': ('WAS WÄRE, WENN', 'Gleiche Geschichte', ['Andere Entscheidung, gleiche Geschichte: weiter {fork}.']),
            'player_load': ('DAUERLÄUFER', '{player}', ['{player} hat schon {dist} Meter abgespult und {kmh} km/h erreicht. Was für eine Lunge.']),
        },
        'analyst': {
            'goal': ('TOR', '{player} · xG {xg}', ['Tor durch {player}, aus {dist} Metern.', 'xG {xg}: {xgw}, und er macht ihn.', '{score}.']),
            'big_chance': ('CHANCE', '{player} · xG {xg}', [['{player} aus {dist} Metern mit {kmh} km/h, xG {xg}.', 'Das ist {xgw} für {team}.'],
                                                            ['Wieder {player}: {dist} Meter, {kmh} km/h.', 'xG {xg}, {xgw}, aber er bleibt draußen.'],
                                                            ['{player} kommt aus {dist} Metern zum Abschluss, xG {xg}.', 'Die Chancen für {team} häufen sich.']]),
            'line_breaking_pass': ('LINIENBRECHER', '{n} Gegner überspielt', ['{player} durchbricht die Linien: ein {dist}-Meter-Pass, {n} Gegner überspielt.', 'So knackt man einen Block.']),
            'pressing_spell': ('PRESSING', '{team} · {p} am Ball', ['{team} presst mit durchschnittlich {p} Spielern in Ballnähe.', 'Das ist eine abgestimmte Falle, kein Einzelanlaufen.']),
            'momentum_swing': ('MOMENTUM', '{a} → {b}', ['Momentum-Index von {a} auf {b}: {team} hat jetzt Ball und Raum.']),
            'sprint_milestone': ('TOPSPEED', '{player} · {kmh} km/h', ['{player} erreicht {kmh} km/h, der bisher schnellste Lauf seines Teams.']),
            'tactic_siege': ('RAUMKONTROLLE', '{team} · {poss}%', [['{team} mit {poss} Prozent Ballbesitz in dieser Phase.', '{opp} ist eingeschnürt und kann nicht aufbauen.'],
                                                                  ['{poss} Prozent Ballbesitz für {team} im Aufbau.', '{opp} verteidigt den Strafraum, nicht den Raum davor.']]),
            'tactic_control': ('KONTROLLE', 'Kontrollindex {control}', ['{team} hat hier {poss} Prozent Ballbesitz, Kontrollindex {control}: {ctlw}.']),
            'tactic_chaos': ('CHAOS', '{turnovers} Ballverluste', ['{turnovers} Ballverluste in dieser Phase, Chaosindex {chaos}.', 'Niemand kontrolliert dieses Spiel.']),
            'tactic_line': ('ABWEHRLINIE', '{team} · {lh} m', [['Die Abwehrkette von {team} steht {lh} Meter vor dem eigenen Tor.', 'Genau in diese Lücke läuft {who}.'],
                                                              ['{team} verteidigt wieder {lh} Meter vor dem Tor.', 'Achten Sie darauf, wie {who} die Lücke davor findet.']]),
            'whatif_setup': ('KONTRAFAKTISCH', '{player} {tweak}', ['Kontrafaktisch: gleicher Seed, gleicher Moment, aber {player} {tweak}.']),
            'whatif_prevented': ('ERGEBNIS', '{base} vs. {fork}', ['Ergebnis: im Was-wäre-wenn kein Tor nach {t} Sekunden.', 'Gerade steht es im Original {base}, im Was-wäre-wenn {fork}.']),
            'whatif_created': ('ERGEBNIS', '{base} vs. {fork}', ['Ergebnis: im Was-wäre-wenn trifft {team}.', 'Zum selben Zeitpunkt steht es im Original {base}, im Was-wäre-wenn {fork}.']),
            'whatif_nochange': ('ERGEBNIS', '{fork}', ['Ergebnis: andere Bewegung, gleicher Spielstand, {fork}.']),
            'player_load': ('BELASTUNG', '{player}', ['{player} bisher: {dist} Meter Laufweg, Topspeed {kmh} km/h, {sprints} Sprints.', 'Synthetischer Puls bisher bis {hr}.']),
        },
        'you': {
            'you_job': ('DEIN JOB', '{pos} · Kette bei {lh} m', ['Du beginnst heute als {pos}, {player}.', 'Deine Kette steht {lh} Meter vor dem Tor, dein nächster Gegenspieler ist {near}.']),
            'you_tackle': ('ZWEIKAMPF GEWONNEN', 'Du stoppst {other}', ['Starkes Tackling, du nimmst {other} den Ball ab.']),
            'you_intercept': ('BALLGEWINN', 'Du liest es', ['Du liest den Pass und gehst dazwischen. Ball gewonnen.']),
            'you_beaten': ('ZWEIKAMPF VERLOREN', '{other} setzt sich durch', ['{other} gewinnt das Duell und nimmt dir den Ball ab.']),
            'you_goal_against': ('GEGENTOR', '{scorer} · {score}', ['{scorer} trifft, {score}.', '{near} war beim Schuss {near_d} Meter von dir entfernt.', 'Du standest {behind} Meter tiefer als der Rest deiner Kette.', 'Du standest {ahead} Meter vor dem Rest deiner Kette.']),
            'you_goal_for': ('TOR!', '{scorer} · {score}', ['{scorer} trifft für dein Team, {score}!']),
            'whatif_setup': ('DEIN WAS-WÄRE-WENN', 'Wenn du {tweak}?', ['Jetzt geht es um dich, {player}. Was wäre, wenn du {tweak}?']),
            'whatif_prevented': ('DEIN WAS-WÄRE-WENN', 'Kein Tor: {fork}', ['Du rückst heraus, und nach {t} Sekunden fällt kein Tor.', '{fork} statt {base}.']),
            'sprint_milestone': ('DEIN TOPSPEED', '{kmh} km/h', ['Das bist du mit {kmh} km/h, dein bisher schnellster Lauf.']),
            'player_load': ('DEIN SPIEL', '{dist} m · {kmh} km/h', ['Bisher hast du {dist} Meter abgespult, {kmh} km/h erreicht und {sprints} Sprints angezogen.', 'Dein synthetischer Puls lag bisher in der Spitze bei {hr}.']),
        },
    },
}
LANGS = tuple(P)
VOICES = ('casual', 'analyst', 'you')


def _fields(s):
    return [f for _, f, _, _ in string.Formatter().parse(s) if f]


def _bucket(lang, key, v):
    return next(w for lim, w in W[lang][key] if v < lim)


def render(kind, params, lang, voice='casual', n=0):
    """-> (caption_title, caption_text, line) or None. n = how often this kind already aired (picks a variant)."""
    L = P.get(lang, P['en'])
    order = {'you': ('you', 'analyst', 'casual'), 'analyst': ('analyst', 'casual'), 'casual': ('casual',)}[voice]
    v, t = next(((v, L[v][kind]) for v in order if kind in L[v]), (None, None))
    if not t:
        return None
    ps = dict(params)
    for k, x in ps.items():  # casual/you voices speak whole numbers; analyst keeps one decimal
        if isinstance(x, float) and k not in ('xg', 't') and (x.is_integer() or v == 'casual' or (v == 'you' and abs(x) >= 10)):
            ps[k] = int(round(x))
    if ps.get('xg') is not None:
        ps['xgw'] = _bucket(lang, 'xgw', ps['xg'])
    if ps.get('control') is not None:
        ps['ctlw'] = _bucket(lang, 'ctlw', ps['control'])
    if 'pos' in ps:
        ps['pos'] = ROLE[lang].get(ps['pos'], ps['pos'])
    if 'tweak' in ps:
        ps['tweak'] = (YOU_TWEAK[lang] if v == 'you' else TWEAK[lang]['analyst' if v == 'analyst' else 'casual']).get(ps['tweak'], ps['tweak'])
    ok = lambda s: all(ps.get(k) is not None for k in _fields(s))
    sents = t[2][n % len(t[2])] if isinstance(t[2][0], list) else t[2]  # variants avoid repeating the same line
    say = ' '.join(s.format(**ps) for s in sents if ok(s))
    return t[0].format(**ps) if ok(t[0]) else t[0], t[1].format(**ps) if ok(t[1]) else '', say


if __name__ == '__main__':  # self-check: every kind renders in every language/voice without literal digits
    import re
    demo = {'player': 'X', 'team': 'T', 'opp': 'O', 'who': 'W', 'score': '1-0', 'base': '1-0', 'fork': '0-0', 't': 69.5,
            'xg': 0.236, 'dist': 11.6, 'kmh': 131.2, 'n': 3, 'p': 2.2, 'a': 85, 'b': -57, 'poss': 99.0, 'control': 59,
            'turnovers': 3, 'chaos': 70, 'lh': 30.1, 'tweak': 'step_up', 'sprints': 22, 'hr': 153,
            'scorer': 'S', 'near': 'N', 'pos': 'CB', 'near_d': 8.3, 'ahead': 1.1, 'other': 'Y'}
    allowed = {'8', '8.3', '1.1', '1', '0', '69', '69.5', '0.236', '11.6', '12', '131.2', '131', '3', '2.2', '2', '85', '57', '99', '59', '70', '30.1', '30', '22', '153', '1-0', '0-0'}
    for lang in LANGS:
        for kind in set(P['en']['casual']) | set(P['en']['you']):
            for voice in VOICES:
                if kind.startswith('you_') and voice != 'you':
                    continue
                for n in range(3):
                    r = render(kind, demo, lang, voice, n)
                    assert r and r[2], (lang, kind, voice)
                    assert set(re.findall(r'\d+(?:\.\d+)?', ' '.join(r))) <= allowed, (lang, kind, voice, r)
    print('phrases ok')
