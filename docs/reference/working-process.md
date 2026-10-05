# Proceso de trabajo

El board de Plane (proyecto **Orca Lab**) es la fuente de las tareas. No la conversación, no la
memoria de un agente, no un TODO en la cabeza de nadie. Si el trabajo no está en el board, todavía
no existe.

El harness de `.claude/` hace cumplir las partes que se olvidan solas. Lo que sigue explica el
porqué de cada guarda: todas nacieron de una falla real, no de una buena intención.

## El ciclo

1. **Arrancar por el board.** Al abrir sesión, el hook `SessionStart` inyecta lo que está en
   `In Progress` y `Todo`, ordenado por prioridad. No hace falta pedirlo.
2. **Leer el ticket completo antes de tocar código**: `orca plane issue <id> --comments`. Los
   comentarios suelen tener la corrección de alcance que el título no dice.
3. **Trabajo nuevo = ticket nuevo, primero.** `orca plane create --project <id> --title … --body-file …`.
   Un hallazgo que aparece a mitad de camino va a su propio ticket con la evidencia; no se cuela en
   el que estabas haciendo.
4. **Rama por unidad de trabajo**, nunca directo a `main`.
5. **Commits como unidades de trabajo**, cada uno con su porqué. Sin `Co-Authored-By` ni atribución
   de IA.
6. **PR contra `ab2webco/main`**, con qué entrega al usuario, qué NO cierra, y cómo se verificó.
7. **El merge a `main` no lo hace el agente.** Pushear, abrir el PR, avisar con el número.
   `main-merge-guard.py` es defensa en profundidad para la Bash tool; el coordinador mergea desde
   GitHub o desde una terminal fuera del agente, sin tocar la guarda. Si Claude Code deja de invocar
   `PreToolUse`, el control local falla abierto: sólo una ruleset del remoto puede imponer la regla
   fuera de la identidad compartida por coordinador y workers.
8. **Mover el estado en Plane** al terminar: `orca plane status set`. Un board que describe un
   estado viejo es peor que no tener board.
9. **Cerrar lo mergeado.** Tras el merge se cierran solas la worktree, la rama local y la remota
   (ver [Cierre de worktrees mergeadas](#cierre-de-worktrees-mergeadas)).
10. **Release** sólo con el checklist de `lab-release-smoke-check.md` pasado y sin worktrees
    mergeadas abiertas (ver [Release: desktop y mobile](#release-desktop-y-mobile)).

## Las guardas, y la falla que las originó

| Guarda                           | Qué hace                                                                                                                                                                                                                                                                          | Por qué existe                                                                                                                                                                                                                                                                                                                         |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `session-start-plane-board.py`   | Inyecta el board al abrir sesión                                                                                                                                                                                                                                                  | El board quedó describiendo un estado de hace horas mientras el trabajo real iba por otro lado                                                                                                                                                                                                                                         |
| `status-line.py`                 | Muestra proyecto · rama · sin-commitear                                                                                                                                                                                                                                           | La status line por defecto no dice ni el directorio ni la rama, así que no había forma de saber dónde se estaba trabajando                                                                                                                                                                                                             |
| `pre-commit-branch-guard.py`     | Antes de commit/push dice rama, upstream y cuánto falta subir                                                                                                                                                                                                                     | Se hicieron 5 commits creyendo que iban a `main` cuando iban a una rama de feature, y se reportó "mergeado a main" siendo falso                                                                                                                                                                                                        |
| `main-merge-guard.py`            | Rechaza desde la Bash tool cualquier push o merge que aterrice en `main`                                                                                                                                                                                                          | Un worker mergeó el PR #73 a `main` por su cuenta, minutos después de que el mensaje que lo dirigía dijera que el merge lo hacía el coordinador. La única barrera era prosa en un brief                                                                                                                                                |
| `board-state-guard.py`           | Rechaza `gh pr create` si el ticket del PR no está en `In Progress`, y al mergear nombra el movimiento a `Done` que falta                                                                                                                                                         | El board se quedó atrás mientras se trabajaba: PRs abiertos y mergeados con su ticket en `Backlog`, seis tickets creados que nadie movió, y uno cerrado por un merge que siguió abierto. Nada de eso se ve desde la terminal, así que recordarlo no alcanzó — `orca plane` no falla cuando el estado está mal, simplemente no se llama |
| `test-result-guard.py`           | Lee el resumen de vitest y bloquea si hay rojos, ignorando el exit code                                                                                                                                                                                                           | **Medido**: `npm test` salió con exit code 0 reportando `Tests 6 failed \| 40082 passed`. Un gate que mire `$?` deja pasar un build roto                                                                                                                                                                                               |
| `pre-release-upstream-check.sh`  | Chequea upstream antes de despachar una release                                                                                                                                                                                                                                   | El checklist de release exige mergear `origin/main` primero y se salteaba                                                                                                                                                                                                                                                              |
| `merged-worktree-close-hook.mjs` | Al abrir sesión y tras cualquier `gh pr merge` cierra worktree y ramas de PRs mergeados; antes de un comando cuyo texto parece un release (ver [Release: desktop y mobile](#release-desktop-y-mobile)) lo rechaza si queda una worktree mergeada abierta o si no pudo verificarlo | El 2026-10-04 había 4 worktrees fuera de `main` y una (#432, ORCA-554) seguía abierta aunque se mergeó antes de `lab.91.rc`. Nada del harness borraba worktrees ni ramas, y el repo tiene `delete_branch_on_merge` en `false`                                                                                                          |

### Por qué el guard del board rechaza cuando no puede leer el board

Un board inaccesible y un board desalineado producen el mismo silencio, y tratar ese
silencio como consentimiento es exactamente cómo el board se quedó atrás. Por eso falla
cerrado. La salida existe y es explícita: `# no-ticket: <razón>` en el comando permite
seguir, pero deja escrito por qué se saltó la regla.

Al mergear, el ticket sale del **título del PR**: el coordinador mergea parado en `main`, así
que ninguna rama lo nombra y el comando lleva solo un número. La primera versión no leía el
título y rechazó tres merges verificados seguidos; sus once tests no lo cazaron porque todos
corrían desde una rama con nombre de ticket — el fixture se parecía al caller que sí permite
(ORCA-354).

### El cuerpo de un heredoc no es texto del comando

Las dos guardas de Bash pasan el comando por `strip_heredocs`
(`.claude/hooks/command_text.py`) antes de analizarlo. Sin eso, el payload de un heredoc se
lee como si fuera el comando: escribir un documento cuyo texto decía «push notifications»
activaba `main-merge-guard` sobre un `cat > archivo`, y los apóstrofos de la prosa hacían
fallar el parseo, que falla cerrado. El cuerpo de un PR de release, que **lista** los tickets
que entran, hacía que `board-state-guard` atribuyera el PR al primero mencionado. Cuatro
bloqueos falsos en una sesión, misma causa (ORCA-362).

Lo que no cambió es la severidad: un comando ilegible que sí nombra un merge sigue rechazado,
y `gh pr create` sin ticket sigue rechazado. Se corrigió el alcance del análisis.

### Ciclo de vida del guard de merge

`minimumVersion` fija Claude Code 2.1.229 como piso de actualizaciones, no un requisito de arranque:
una instalación anterior todavía puede iniciar. La versión cubre el principal sospechoso upstream,
una fuga de handles del file watcher, pero no hay logs que prueben causalidad. Evita downgrades
futuros, pero no actualiza un proceso que ya está corriendo. Después de actualizar Claude Code o de cambiar
`.claude/settings.json` o `.claude/hooks/`, cerrá la sesión y arrancá una sesión nueva; no confíes en
que el hot reload haya incorporado una guarda nueva a una sesión larga.

Esto reduce la exposición al fallo observado en ORCA-206, pero no convierte al hook en una frontera
de seguridad. Si el host no lo invoca, el comando sigue su curso y no hay señal local confiable de
la ausencia. La protección obligatoria contra merges directos a `main` debe vivir en una ruleset de
la organización; el hook conserva valor como rechazo temprano y explicación dentro del agente.

### Cierre de worktrees mergeadas

Los PRs se mergean con squash, así que una rama mergeada nunca es ancestro de `main` y
`git branch --merged` las da a todas por abiertas. La prueba fiable es el `headRefOid` de un PR en
estado `MERGED`: la worktree está entregada si su head es ese commit o un ancestro suyo (quedó
detrás, por ejemplo tras un commit de review empujado desde otro clon; todo lo que tiene ya se
mergeó). Si ese commit no está en el repo local, se trae con
`git fetch --quiet <remoto> refs/pull/<N>/head` (GitHub conserva el head de cada PR), que no crea
refs; si aun así falta, la rama queda como `unverified <rama>: merged head of #N not available locally`.

Con eso, el cierre quita la worktree, borra la rama local y borra la remota con
`--force-with-lease`, así que la remota sólo se borra si su head sigue siendo el de la worktree o el
que se mergeó. Si uno de los dos borrados falla, la misma línea `closed` lo dice
(`local branch not deleted: …` o `remote branch not deleted: …`). La worktree se quita con
`orca worktree rm` cuando hay una CLI de Orca configurada; sólo se recurre a `git worktree remove`
si no la hay o si Orca responde `selector_not_found` (no conoce esa worktree). Cualquier otro rechazo
de Orca se respeta: la worktree queda como `worktree removal failed (<ruta>): <error de Orca>`.

Nunca se cierra:

- una worktree con cambios sin commitear, incluidos los archivos sin seguimiento aunque
  `status.showUntrackedFiles=no` los oculte;
- una con commits posteriores al head mergeado;
- la worktree desde la que se ejecuta el cierre (su directorio actual) ni la que apunta
  `CLAUDE_PROJECT_DIR`;
- una con una terminal de Orca en estado `running` que produjo salida en los últimos 10 minutos.
  Una terminal inactiva no la protege: `orca worktree rm` la detiene, y eso es lo buscado;
- ninguna, mientras haya una CLI de Orca configurada y `orca terminal list` falle, tarde o devuelva
  algo ilegible: todas quedan con `could not read Orca terminals (<motivo>)`.

Esas quedan abiertas y bloquean la release hasta que alguien decida. Además:

- Los archivos ignorados por git (por ejemplo `.env`) no cuentan como cambios y se borran junto con
  la worktree. Si guardas ahí algo que quieras conservar, cópialo antes del merge.
- Si el nombre de una rama mergeada se reutilizó para trabajo que no desciende de ningún head
  mergeado, esa worktree no se toca ni bloquea nada.
- Una worktree listada cuyo directorio ya no existe se salta con
  `skipped <rama>: directory missing; run git worktree prune` y no bloquea la release (Git < 2.31
  no marca esas entradas como `prunable`).
- Tras un comando cuyo texto contiene `pr … merge` (también con `-R o/r` en medio o partido con
  `\` al final de línea) se toma el primer argumento posicional de cada `gh pr merge` (número, URL del PR o rama) y sólo se
  cierra si el PR ya figura `MERGED`: un `--auto` que sólo encola el merge no cierra nada. Si no se
  puede leer ningún selector (por ejemplo, el merge va dentro de un heredoc), se revisan todas las
  worktrees, y sólo se cierran las que tienen su PR mergeado.

Para cerrar a mano (nunca cierra la worktree desde la que lo ejecutas):

```bash
node config/scripts/merged-worktree-close.mjs [--dry-run] [--branch <b>]
```

Las worktrees aparecen anidadas dentro de la raíz del repo por el ajuste global de Orca
`nestWorkspaces=true` (Settings) del dueño, no porque un agente las cree ahí.

## Release: desktop y mobile

El gate de `merged-worktree-close-hook.mjs` aplica a las tres releases: si queda una worktree
mergeada abierta (sucia, con commits posteriores al merge, con una terminal activa, sin poder leer
las terminales de Orca, o que no se pudo quitar), la release se rechaza. El gate falla cerrado: la
rechaza también, diciendo qué no pudo verificar y por qué, cuando

- no puede leer los PRs de una rama (`gh` falla o tarda más de 20 s, devuelve algo ilegible, o el
  remoto no es una URL de GitHub): `unverified <rama>: could not read its PRs (<motivo>)`;
- no consigue el head mergeado de un PR (ver arriba);
- se agota el presupuesto de tiempo: cada evento tiene un plazo y cada comando de `git`, `gh` u
  `orca` recibe sólo lo que queda de él (como mucho 20 s). Bajo el gate son 60 s y al abrir sesión
  75 s. Tras un merge son 65 s para todo el evento, repartidos entre la relectura de cada PR y cada
  cierre, porque el `git worktree list` del cierre no respeta el plazo (sin la lista no hay ramas
  que reportar) y puede sumar hasta 20 s más; así todo queda por debajo del timeout de 90 s de los
  hooks. Las ramas que no alcanzó a revisar quedan como `unverified <rama>: time budget exhausted`;
- el repo de destino no es un repositorio git: `unverified: <dir> is not a git repository`;
- el propio cierre falla con un error inesperado.

Fuera del gate (al abrir sesión y tras `gh pr merge`) el hook nunca bloquea: lo que no puede
verificar lo salta en silencio.

El hook ve todos los comandos Bash, sin filtro `if`, y decide si corre el gate con una coincidencia
de texto amplia sobre el comando completo, sin distinguir mayúsculas ni interpretar la sintaxis del
shell (comillas, heredocs, `if`, `{ …; }`, `bash -c`, flags como `gh -R`): perseguir cada forma de
escribir un release no tiene fin, y el gate no debe depender de leer bien el comando. Sólo se unen
antes las líneas partidas con `\` al final, como hace el shell. Corre el gate si el texto contiene

- `workflow … run` o `release … create`/`new`, con lo que sea entre las dos palabras salvo otro
  comando (así entra `gh workflow -R o/r run`), `/dispatches`, `mobile-ios-v`, `mobile-android-v`,
  `mobile-ios-release`, `mobile-android-release`, `lab-release` o `lab release`;
- o la palabra `push` junto con `--tags`, `--follow-tags`, `--mirror`, `refs/tags`, `refs/*` o un
  refspec `*` suelto (`'*'`, `"*"` o `*` entre espacios).

Para cualquier otro comando sale en unos milisegundos, sin llamar a `git` ni a `gh`. Los falsos
positivos son esperados: `grep "workflow run" docs` también corre el gate, que lo deja pasar si no
queda ninguna worktree mergeada abierta y lo rechaza si queda alguna. Por eso el rechazo dice
"Comando bloqueado: parece un release…" y no da por hecho que lo sea; en ese caso cierra o resuelve
las worktrees que nombra, o reescribe el comando.

El gate revisa el repo al que apunta el comando: el `<dir>` de `git -C <dir>` o de un `cd <dir>`
previo en la misma línea (si ninguna parte del comando coincide por sí sola, el último `cd`); si no
hay, `CLAUDE_PROJECT_DIR`; si tampoco, el directorio de la sesión.

Los cambios de mobile siguen el mismo ciclo que desktop: ticket → rama → PR → merge → cierre.

**Desktop (Lab Release).** Primero un RC, que el dueño prueba:

```bash
gh workflow run "Lab Release" -R ab2webco/orca-oss --ref main -f release_candidate=true
```

Validado el RC, la final se despacha con `release_candidate=false` y toma el **siguiente** número
lab. Un tag RC nunca se promueve. El checklist completo está en
[`lab-release-smoke-check.md`](./lab-release-smoke-check.md).

**Mobile.** Cada plataforma tiene su workflow, desacoplado para que la revisión de App Store no
frene a Android:

- **iOS** ([`mobile-ios-release.yml`](../../.github/workflows/mobile-ios-release.yml)): se dispara
  con un push de tag `mobile-ios-v*` o con `workflow_dispatch` (inputs `bump_patch_version`,
  `release_version`, `testflight_changelog`). La versión la resuelve el lane de fastlane
  `prepare_release_version` (`mobile/fastlane/Fastfile`): `release_version` si se pasa, si no
  `expo.version` de `mobile/app.json`, o el primer patch abierto en App Store con
  `bump_patch_version`. El build number es el último de TestFlight + 1, y ambos se escriben en
  `app.json` antes del build. El nombre del tag no se compara con la versión.
- **Android** ([`mobile-android-release.yml`](../../.github/workflows/mobile-android-release.yml)):
  se dispara con un push de tag `mobile-android-v*` o con `workflow_dispatch` (inputs
  `release_version`, `publish_github_release`). `mobile/scripts/prepare-android-release.mjs` toma
  `expo.version` y `expo.android.versionCode` de `mobile/app.json` tal como están commiteados: el tag
  y `release_version` sólo pueden coincidir con esa versión, y cualquier cambio de versión o
  `versionCode` se commitea antes en `app.json`.

## Verificación: lo que no se puede dar por bueno

Además de [`agent-verification-traps.md`](./agent-verification-traps.md), estas salieron de una
sesión real y valen para cualquiera que trabaje acá, humano o agente:

- **El exit code de `npm test` miente.** Leé `Tests …` / `Test Files …`. El guard lo bloquea, pero
  si lo corrés a mano, mirá los números.
- **Cero marcadores de conflicto no significa merge correcto.** Después de que desaparecieron todos
  aparecieron: un import duplicado, un import huérfano, una dependencia nueva sin instalar y dos
  violaciones de `max-lines` creadas por la fusión. Sólo las cazó el typecheck.
- **Un agente puede fabricarse su propio verde.** Uno cambió una constante de protocolo y escribió
  un test nuevo que la respaldara, con una premisa que contradecía la documentación de upstream.
  Cuando un agente entrega un cambio + un test que lo valida, verificá que el test exista en alguno
  de los lados y no lo haya inventado para taparse.
- **Un test que no discrimina no es cobertura.** Antes de dar algo por probado, corré el test contra
  el código viejo. Si pasa igual, no prueba nada.
- **Después de un merge que toca `package.json`, instalá antes de creer un typecheck rojo.**
- **Después de un merge que toca `daemon-protocol-version.ts`**, revisá los dos espejos de
  compatibilidad (`local-build-compatibility-contract.ts` y `.json`). No están en conflicto nunca,
  así que ningún resolutor los mira, y el `.json` viaja empaquetado.

## Delegar a agentes

Los agentes sirven para abarcar (explorar en paralelo, resolver lotes disjuntos de conflictos,
revisar con lentes distintos). No sirven para confiar sin revisar:

- Dales archivos **disjuntos** cuando trabajen en paralelo sobre el mismo árbol.
- Pediles que declaren las dudas en vez de resolver en silencio.
- **Verificá centralmente**: typecheck, lint y tests después de que todos terminen. En una sesión
  real, los agentes dejaron el árbol sin marcadores y con siete defectos que sólo aparecieron en la
  verificación central.
- Cerralos cuando terminan. Un agente idle que sigue notificando es ruido.
