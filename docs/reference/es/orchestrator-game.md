---
sourceHash: 96cce75123659a8d
---

# El juego orquestador de Agent Teams

Los panes de Claude Agent Teams (`orca claude-teams`) cargan un plugin de Claude Code que convierte
la sesión en un pequeño juego: una escena pixel-art en el spinner, tarjetas por cada fase del flujo,
un HUD de compañeros sobre el prompt y recompensas cuando se hace merge de las revisiones, el CI se pone
verde o los tickets avanzan (los del propio líder del proyecto y los de sus miembros). Empezó como el
modo quest del plugin `o` en koombea/cineco-orchestrator (Jucer Orozco) y vive en
[`resources/claude-plugins/orca-game`](../../../resources/claude-plugins/orca-game).

Claude a secas, Codex y cualquier otro agente no se tocan.

## Cuándo se carga

Las dos formas de entrar a un equipo lo cargan con `--plugin-dir <bundled plugin>` y el entorno `ORCA_GAME_*`
([`orchestrator-game-launch.ts`](../../../src/main/claude/orchestrator-game-launch.ts)):

- `orca claude-teams`: `agentTeams.prepareLaunch` los devuelve y la CLI los pone antes de los args
  del propio usuario (no en Windows, donde ese comando se niega a ejecutarse);
- un lanzamiento directo de `claude` que la app convierte en un equipo (modo Settings → Agent Teams):
  el plan de lanzamiento los inserta después del ejecutable
  ([`claude-agent-teams-shim-env.ts`](../../../src/main/runtime/claude-agent-teams-shim-env.ts)), solo
  para workspaces locales, ya que la carpeta del plugin está en esta máquina. En Windows los args se
  entrecomillan para el shell del pane (ver [En Windows](#en-windows)); un pane de WSL no recibe juego.

Un miembro de Claude que `orca game launch` inicia, o que `game resume-members` reinicia o reanuda,
recibe los mismos args y el mismo entorno más `ORCA_GAME_ROLE=member`, así que dibuja su banda de
miembro (ver [El pane de un miembro](#el-pane-de-un-miembro)). Van en el propio comando de arranque del miembro,
antes de que la secuenciación del setup lo envuelva, y bajo Agent Teams el lanzamiento del equipo ya
no añade encima el juego del líder. Un miembro codex, un `orchestration worker-start` sin el juego,
un miembro por SSH o WSL y un proyecto con `orchestratorGame.orchestrator.memberGame: false`
(Settings: **Game in member panes**) se quedan sin juego. `game.state` no lee My PRs, To Do ni el
ticket del tracker cuando quien llama es un miembro: su banda no muestra ninguno de ellos y toma el
ticket de su propio nombre.

Solo se carga cuando se cumplen todas estas condiciones; si no, Claude arranca exactamente igual que antes:

- el modo efectivo no es `off`;
- Claude Code es 2.1.287 o más reciente (mods). La versión se consulta con `claude --version`, de
  forma asíncrona y en caché durante diez minutos; una versión desconocida cuenta como demasiado antigua;
- la carpeta del plugin existe en los recursos de la app.

`ORCA_GAME_CLI` lleva la ruta absoluta de la CLI de Orca que ya ejecuta el shim de tmux de Agent Teams.
El mod consulta solo esa ruta y nunca un `orca` a secas, que en Linux es el lector de pantalla de
GNOME. Sin él la escena se sigue dibujando y la banda dice que el estado no está disponible.

`ORCA_GAME_LOCALE` es el idioma de la interfaz de Orca resuelto igual que lo hace el renderer
(`system` lee el locale del sistema operativo; un paquete de idioma de plugin se asigna por su tag),
uno de `en`, `es`, y si no `en`. El mod traduce sus textos a partir de él. Un Raster solo admite
caracteres de ancho 1, así que un carácter ancho dentro del pixel art (un compañero o un nombre de
archivo en CJK que informe un agente) se dibuja como `?`.

### El pane de un miembro

Un pane iniciado con `ORCA_GAME_ROLE=member`, o uno al que `game state` llama miembro, dibuja una
banda de miembro en lugar de la del líder: una línea con su personaje, su ticket, la tarjeta de fase
que muestra, su PR y su CI ([`member-band.tsx`](../../../resources/claude-plugins/orca-game/hooks/member-band.tsx)).
No tiene Panel, chips de equipo, HUD del grupo ni botones del líder, solo una fila de menú con los
colores del propio pane: **Collapse** pliega la banda a esa fila y quita la escena del spinner durante
la sesión, **Text** es el mismo interruptor de texto del líder y **Refresh** vuelve a leer `game state`.
Mientras el `orca orchestration ask` del miembro espera al líder, una línea muestra la pregunta
(`? Asked <lead>: …`), que se mantiene al plegar la banda y se borra cuando vuelve la respuesta. Sus
respuestas usan las mismas tarjetas que las del líder, y la escena se sigue dibujando sobre el
spinner salvo que esté plegada o en modo texto.

Un miembro local dibuja el archivo de escena de su líder cuando su propio worktree no puede leerlo:
`.orca/` suele estar excluido de git, así que a un worktree de miembro recién creado le falta el
archivo que dibuja el líder, y `game state` lee la copia del líder a través del pane padre del
miembro antes de volver a Quest (ORCA-870).

### El brief de una línea de un miembro

A un miembro que `game launch` inicia en una terminal creada por Orca se le escribe una sola línea,
`Read your Orca Lab brief at .orca/briefs/<dispatchId>.md (task <taskId>) and follow it.`, en lugar
del preámbulo del dispatch. El preámbulo, con sus comandos de ciclo de vida, sus IDs y su capability,
se escribe en ese archivo dentro del workspace del miembro, en el host que ejecuta su PTY: el disco
local (un worktree de WSL a través de su ruta `\\wsl.localhost\…`) o el sistema de archivos de la
conexión SSH ([`dispatch-brief-delivery.ts`](../../../src/main/runtime/orchestration/dispatch-brief-delivery.ts)).
La línea nombra el archivo relativo al cwd del miembro, así que el miembro lo lee desde su propio lado
de WSL o SSH. Un repo alojado en un runtime remoto de Orca, o una ruta local que esta máquina no
puede escribir tal como viene, recibe el preámbulo completo. `.orca/briefs/`
lleva su propio `.gitignore` (`*`), así que el brief nunca aparece en `git status`; en local el
archivo es `0600`. Esto vale para cualquier agente y host, workspaces de carpeta incluidos. El mod
del miembro dibuja la línea como un bloque **Brief received** que nombra el archivo.

El preámbulo completo se escribe como antes cuando el miembro no es un miembro del juego, el proyecto
desactiva **Game in member panes** o el modo es `off`, la terminal se pasó en lugar de iniciarla Orca,
o el brief no se puede escribir (sin workspace, sin sistema de archivos SSH, una escritura fallida).
Decide el host que ejecuta `worker-start`, así que un host más antiguo escribe el preámbulo como
siempre. Un `orchestration dispatch` posterior a un miembro que ya está en marcha sigue escribiendo
el preámbulo completo.

### En Windows

El shell del pane interpreta la línea de lanzamiento, así que `--plugin-dir` se entrecomilla para él
([`orchestrator-game-pane-shell.ts`](../../../src/main/claude/orchestrator-game-pane-shell.ts) elige
el shell que abrirá el spawn del pty, a partir de los mismos ajustes y del runtime del proyecto):

| Shell del pane                                                    | Entrecomillado de la carpeta del plugin                                                                                        |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| PowerShell 5.1 y 7 (el predeterminado)                            | un literal `'…'`, con `'` duplicado                                                                                            |
| cmd.exe                                                           | `"…"`, saliendo de las comillas en cada `%` como `"^%"`; `& ^ ( ) !` quedan dentro de ellas                                    |
| Git Bash / MSYS                                                   | una palabra POSIX `'…'`, conservando las barras invertidas                                                                     |
| WSL (`wsl.exe`, un worktree `\\wsl$`, un runtime de proyecto WSL) | sin juego: el Claude de Linux de la distro no puede cargar una ruta de plugin de Windows, y `ORCA_GAME_*` no cruza a la distro |

Un pane de cmd con la expansión retardada activada en el registro seguiría leyendo `!…!` en la ruta;
Orca no abre cmd con `/V:ON`.

`ORCA_GAME_CLI` se entrega con barras normales (`C:/Program Files/…/orca.exe`): Claude Code ejecuta
su herramienta Bash a través de Git Bash en Windows, que ejecuta una palabra con `/` como una ruta,
así que el `"$ORCA_GAME_CLI" game lead` de las skills funciona ahí; `orca game lead` imprime sus
comandos como una sola palabra entrecomillada al estilo POSIX con barras normales por la misma razón.
Un Orca empaquetado entrega `resources/bin/orca.exe`; el `orca-dev.cmd` de una build de desarrollo no
se puede iniciar sin un shell, así que el mod ejecuta una CLI `.cmd`/`.bat` como
`%ComSpec% /d /v:off /s /c %ORCA_GAME_CLI_LINE%`, con la línea de comandos entrecomillada viajando en
esa variable de entorno, que cmd expande una vez después de interpretarla; un argumento con una
comilla o un salto de línea se rechaza en lugar de ejecutarse
([`cli-invocation.ts`](../../../resources/claude-plugins/orca-game/hooks/cli-invocation.ts)).

Qué se verifica y dónde:

- Tests unitarios, en todos los sistemas operativos: el entrecomillado de cada shell para una ruta
  con espacios, `& ^ % ! ( ) '` y unicode; la elección del shell del pane y la omisión de WSL; la
  invocación por cmd de una CLI `.cmd` y la escritura nativa de un `.exe` (vitest y `claude plugin test`).
- El job de CI de Windows (`Windows platform tests`) ejecuta las suites del juego y
  `claude plugin validate` / `claude plugin test` del mod en un host Windows.
- No lo verifica ningún chequeo automatizado, solo un escritorio Windows: un pane real de cmd,
  PowerShell y Git Bash cargando el mod, la banda consultando `orca.exe` y el `orca-dev.cmd` de una
  build de desarrollo ejecutado a través de cmd.exe por el motor de Claude Code.

## Capas de configuración

Para empezar desde cero el `orca.yaml` de un proyecto, ejecuta `/orca-game:setup` en un pane de
Claude del repo: lee lo que usa el proyecto (claves del tracker, servidores MCP, reglas de `CLAUDE.md`,
scripts de `bin/`), pregunta qué integrar una pregunta a la vez, muestra el YAML, lo escribe una vez
confirmado y resuelve todas las advertencias de `orca game state`. Su resumen de claves está en
[`skills/setup/reference.md`](../../../resources/claude-plugins/orca-game/skills/setup/reference.md).

Para leer lo que resolvió un pane, ejecuta `/orca-game:state` en él: el mod ejecuta `game state --json`
a través de la CLI que Orca entregó al pane (`ORCA_GAME_CLI`, a través de `cmd.exe` para un `.cmd` de
Windows, así que no interviene el shell del pane) e imprime cada ajuste con la capa que lo fijó, el
modo y el render que esta sesión fijó por sí misma, el líder y sus miembros con sus huecos, un STOP
activo, advertencias y enlaces
([`state-report.ts`](../../../resources/claude-plugins/orca-game/hooks/state-report.ts)). En una sesión
que Orca no inició con su juego, lo dice en su lugar. Todos los comandos del juego viven bajo `/orca-game:`
(`state`, `view`, `mode`, `render`, `demo`, `quest`, `setup`, `lead`), cada uno una skill del plugin
que el mod responde sin un turno del modelo, porque el motor rechaza un `:` en un nombre que registra
un mod; `/quest` se mantiene como la forma corta registrada por el mod que se ejecuta a mitad de turno.
Los botones del proyecto (`actions[].command`) conservan los nombres que eligió el proyecto.

Cada campo se resuelve por separado; una capa posterior gana
([`orchestrator-game-config.ts`](../../../src/shared/orchestrator-game-config.ts)):

1. Valores predeterminados de Orca: `mode: on`, `show: true`, `scene: quest`, `hud`, `rewards` y
   `tracker` todos en `true`, `render: classic`, `timezone: local`.
2. Settings globales → Agents → **Agent Teams game** (`orchestratorGame`).
3. El `orca.yaml` versionado del proyecto, que pertenece a quien sea dueño del repo, un dev o una empresa.
4. Settings → el proyecto → **Agent Teams game**, solo en esta máquina
   (`orchestratorGameProjects[repoId]`). Cada fila puede decir **Inherit**.

Ambas páginas de Settings agrupan los controles del juego (**Show the game**, **Default view** con el costo de cada vista, escena, HUD de compañeros, recompensas, seguimiento
del work item, dónde se abren los enlaces, render y zona horaria) bajo un encabezado **Agent Teams game** que indica que solo se aplican a los panes de Claude
Agent Teams. Bajo el selector de escena, una vista previa pinta la escena efectiva con el propio
código de dibujo del mod
([`OrchestratorGameScenePreview.tsx`](../../../src/renderer/src/components/settings/OrchestratorGameScenePreview.tsx)
importa `hooks/scene.ts`, `scenery.ts`, `scenes/` y, para `render: hd`, `scene-hd.ts`), así que no
puede desviarse de lo que dibuja un pane en el render efectivo:
la escena del spinner recorriendo las seis fases con el personaje de cada fase debajo, o un único
fotograma fijo cuando el sistema pide movimiento reducido. `zen` indica lo que oculta, `off` dice que
el pane arranca como Claude a secas, un id no instalado muestra `quest` (a lo que vuelve el mod) y una
escena de plugin muestra una nota en su lugar, porque su definición solo llega al mod a través de
`game.state`, nunca al renderer. La build del renderer elimina el TypeScript del mod con su propio plugin
([`orca-game-mod-transform.ts`](../../../config/build-plugins/orca-game-mod-transform.ts)): el
`tsconfig.json` del mod fija una factory JSX `h` que el runtime automático de React rechaza.

`flat` no dibuja ningún `Raster` y no hace blit de nada (sus condiciones son `isSceneMode` en
`hooks/quest-policy.ts`); el HUD y las tarjetas del Panel se convierten en las líneas de texto de
`hooks/flat-view.ts`, a partir del mismo sondeo de `orca game state`. Un pane cambia a él con el chip
`≡ Text` / `▦ Scene` de la banda, la tecla `0` del Panel o `/orca-game:mode flat`, y desde ORCA-689
`orca.yaml` y Settings también pueden guardarlo. Un mod anterior a flat lee un `flat` guardado (o un
`ORCA_GAME_MODE` con valor `flat`) como desconocido a través de `isQuestMode` y sigue dibujando la escena.

`show: false` (**Show the game**) oculta el juego y conserva `mode` como la vista a la que vuelve:
el pane se lanza como Claude a secas y `orca game state` informa `mode: off`, con la capa que fijó
`show` como origen.

### Vistas

El selector de vistas nombra una única lista de vistas
([`orchestrator-game-view.ts`](../../../src/shared/orchestrator-game-view.ts), reflejada en el
`hooks/game-view.ts` del mod): `off` y `flat` (ligeras), `zen` y `2d-classic` (medias), `2d-hd` (pesada);
las vistas 3D se suman con ORCA-683. Una vista se guarda como las claves `mode` y `render`, así que los
archivos y mods más antiguos siguen funcionando: `2d-classic` es `mode: on` + `render: classic`, `2d-hd`
es `mode: on` + `render: hd` (se conserva un look `hd-compact`), y las demás fijan solo `mode`. La
vista sugerida es una regla sobre la memoria del host en `suggestedOrchestratorGameView`: `flat` con
8 GiB o menos, o con menos de 2 GiB libres; `2d-classic` hasta 16 GiB; `2d-hd` por encima. `orca game state`
la lleva como `suggestedView` (leída como mucho una vez por minuto) junto a `viewScopes`, los ámbitos
en los que el host puede guardar una vista para este pane: `project` solo cuando el worktree del pane
tiene un repo, y `global`.

`orca game view <view> --scope project|global` (RPC `game.setView`) guarda una vista más allá del pane:
`project` escribe la capa propia del repo en esta máquina (`orchestratorGameProjects[repoId]`, lo que
edita Settings → el proyecto, mostrado como `this machine`), `global` escribe la capa global de Settings.
Nunca escribe `orca.yaml`. Elegir una vista distinta de `off` también fija `show: true` en esa capa
cuando el juego estaba oculto ahí. Una página de Settings abierta muestra el cambio de inmediato
(`settings:changed`); los panes lo ven en su siguiente sondeo de `game state`.

En un pane, `/orca-game:view` lista las vistas con su costo, la actual (`●`) y la sugerida (`★`);
`/orca-game:view <view> [pane|project|global]` la cambia (`hooks/view-command.ts`,
`hooks/view-switch.ts`). `pane`, el predeterminado, es un override de sesión como `/orca-game:mode` y
`/orca-game:render`, que siguen como estaban y se corresponden con las mismas vistas. `project` y `global`
ejecutan `orca game view` y luego descartan el override de este pane, así que el pane sigue lo que se
guardó y cualquier cambio posterior desde Settings. Cuando el estado no trae `viewScopes` (un Orca más
antiguo) o la CLI rechaza el comando (un `orca` más antiguo en un host SSH), la vista se aplica solo a
este pane y la respuesta lo dice.

El menú del Panel tiene el mismo selector (`hooks/view-picker.tsx`): `◐ View: <current>` abre una fila
de chips de ámbito (este pane y los ámbitos que Orca puede guardar) y una fila de chips de vista con su
costo, `●` en la vista actual y `★` en la sugerida. Una elección pasa por el mismo `switchView` que el
comando, cierra el selector y nombra el resultado en un toast. En un teléfono ambas filas son chips
táctiles, y el menú ocupa dos filas de chips a unas 40 columnas.

```yaml
# orca.yaml
orchestratorGame:
  mode: zen # on | zen | flat | off
  show: true # false hides the game and keeps mode for when it is shown again
  scene: quest # quest, vigilante, jrpg, tamer, or a plugin scene: <publisher>.<id>/<scene id>
  sceneFile: .orca/scenes/mario.json # optional: the project's own scene; wins over scene (below)
  hud: true # teammate band above the prompt
  rewards: false # XP, level-ups, celebrations
  rewardWeights: # XP per reward, 0 to 1000; 0 turns one off (see "The scoring table" below)
    ci-green: 10
    member-claimed: 0
  tracker: true # follow the linked work item in the flow
  openLinks: system # orca (default) | system: where the game's links open
  render: hd # classic (default) | hd | hd-compact: see "Render: classic, hd or hd-compact" below
  timezone: America/Bogota # local (default) | an IANA zone: when hd turns to night
```

`openLinks: system` abre todos los enlaces del juego (PR, CI, ticket, actividad, los encabezados de las
listas de PRs y To Do, enlaces del proyecto) en el navegador predeterminado del escritorio, donde la
persona tiene la sesión iniciada en GitHub y Jira; el navegador propio de Orca no tiene esa sesión, así
que un repo privado muestra un 404 ahí. El mod se lo pide a Orca con `orca game open-link <url>` (RPC
`game.openLink`, solo http(s), `shell.openExternal` de Electron en macOS, Linux y Windows). Un host sin
escritorio (`orca serve`) o un Orca más antiguo que el mod lo rechaza, y el enlace se abre en una
pestaña de Orca como antes. Settings lo muestra como **Open links in** (Orca / System browser), de
forma global y por proyecto.

Un valor no válido se descarta y se informa (Settings muestra el origen de cada valor,
`orca game state` lista las advertencias); nunca detiene el lanzamiento.

Para un worktree SSH, la capa del proyecto se lee desde el host a través del sistema de archivos SSH
([`worktree-orca-yaml.ts`](../../../src/main/worktree-orca-yaml.ts)); mientras el host está desconectado,
las demás capas siguen aplicándose.

`rewardWeights` se fusiona clave por clave como `orchestrator`: el proyecto puede bajar una recompensa
en `orca.yaml` mientras un dev desactiva otra en el JSON de Settings del proyecto. Igual que las listas
de abajo, no tiene editor en Settings.

`links` y `activity` (abajo) son listas, así que una capa posterior que fije una reemplaza la lista
entera en lugar de fusionarla. Settings no tiene editor para ellas; `orca.yaml` es donde se escriben,
y un valor en una capa de Settings se valida de la misma forma.

## Enlaces del proyecto y actividad

Cada proyecto muestra sus propias integraciones en la escena. Las de Orca (la revisión, su CI y el
work item) vienen incorporadas; cualquier otra, como un gestor de pruebas al que se accede a través de
un servidor MCP, se declara en `orca.yaml` ([`orchestrator-game-integrations.ts`](../../../src/shared/orchestrator-game-integrations.ts)):

```yaml
# orca.yaml
orchestratorGame:
  links: # static, at most 6
    - label: Test plan # at most 24 characters
      url: https://<your-tambora-host>/projects/CIN
    - label: Ticket
      url: https://jira.example.com/browse/{workItem.identifier}
  activity: # at most 8 rules
    - name: Tambora run # at most 24 characters
      tools: mcp__tambora__* # tool name glob; every MCP tool when omitted
      match: 'TR-([A-Z]+)-\d+' # regular expression, at most 200 characters
      url: https://<your-tambora-host>/projects/{1}/testruns/{0}
    - name: Tambora case
      tools: mcp__tambora__*
      match: 'TC-([A-Z]+)-\d+'
      url: https://<your-tambora-host>/{1}/testcase/{0}
```

- **URLs de los enlaces**: pueden usar `{workItem.identifier}`, `{workItem.provider}`, `{branch}` y
  `{review.number}`. Los valores se codifican para URL, y un enlace cuyo placeholder no tiene valor en
  este worktree se omite.
- **URLs de actividad**: usan `{0}` para la coincidencia completa y `{1}`–`{9}` para sus grupos; se
  rechaza un grupo que el patrón no tiene.
- **Validación.** Una URL debe ser `http` o `https` con un host literal: sin placeholder, llave ni
  `user@` antes de la ruta, así que un valor nunca puede cambiar adónde apunta un enlace. Un patrón debe
  compilar y no debe coincidir con texto vacío. Cada entrada no válida se descarta con una advertencia
  en `orca game state`, como cualquier otro campo de `orchestratorGame`.
- **Coincidencia.** Por cada llamada a una herramienta `mcp__*` que hace un agente, el servidor de hooks
  guarda la llamada en memoria: la entrada como JSON (como mucho 2 KB) y el texto del resultado (como
  mucho 4 KB), las últimas ocho llamadas por pane ([`orchestrator-game-mcp-calls.ts`](../../../src/main/agent-hooks/orchestrator-game-mcp-calls.ts)).
  `orca game state` aplica las reglas sobre la entrada seguida del resultado, recortada a los primeros
  4 KB, empezando por la llamada más reciente; gana la primera regla que coincide. Solo el id
  coincidente y la URL que construyó salen de la memoria. Una llamada está `running` desde su
  `PreToolUse` hasta su `PostToolUse`, un fallo o el `Stop` del turno.
- **Memoria.** La coincidencia más reciente por pane se recuerda una vez que su llamada sale de esas
  ocho ([`orchestrator-game-activity-memory.ts`](../../../src/main/runtime/orchestrator-game-activity-memory.ts)),
  así que el enlace se mantiene hasta que coincida una llamada más nueva; una recordada nunca está
  `running`. Se guardan como mucho 64 panes, y se descarta primero el que coincidió hace más tiempo.
- **Agentes por SSH.** El relay no reenvía la entrada en bruto de las herramientas, así que una
  llamada remota se compara solo con el texto de su resultado.
- **Reglas incorporadas**: siguen a las reglas del proyecto y solo existen para un host que este
  worktree ya reveló: una clave del proyecto del work item (`ORCA-12` junto a `ORCA-586`) en una
  llamada MCP de Plane, Jira o Linear enlaza a través de la propia URL del work item, y un
  `pullNumber`/`issue_number` (GitHub) o `merge_request_iid`/`issue_iid` (GitLab) en la entrada MCP de
  ese proveedor enlaza al repositorio de la revisión. Sin work item ni revisión no hay host, ni regla.

Nada específico de un proyecto vive en Orca: el ejemplo de cineco de Koombea (su host de Tambora y sus
claves) está en el propio `orca.yaml` de ese proyecto.

## Lo que lee el juego: `orca game state --json`

El plugin lee esto cuando Orca empuja un cambio en la flota, cada 30 segundos y después de cada turno.
El aviso es `orca game watch`, que el mod mantiene en streaming durante la sesión: hace long-polling
de `game.fleetWait` e imprime `fleet <version>` cuando se crea o elimina un worktree, cambia el estado
del agente de un miembro, desaparece la terminal de un miembro, el líder registra, libera, reanuda o
descarta un miembro, se mueve el interruptor STOP o llega correo de orquestación. Una ráfaga (un
lanzamiento crea un worktree, una terminal y un registro) es una sola versión, y el mod lee una vez
por ráfaga de 300 ms; un cambio que llega mientras corre una lectura recibe una lectura después. El
sondeo de 30 segundos se mantiene porque los cambios de PR y CI, los miembros en hosts emparejados y
un Orca sin `game.fleetWait` no avisan de nada. Una lectura que falla conserva la flota que tenía, la
banda dice `updated <age> ago · retrying` y el mod vuelve a leer al cabo de 10 segundos. Una lectura
tiene 45 segundos antes de contar como fallida. Resuelve el pane que llama a partir de
`ORCA_WORKTREE_ID`, `ORCA_TERMINAL_HANDLE` y `ORCA_PANE_KEY`
([constructor](../../../src/main/runtime/orchestrator-game-state-builder.ts)). Los miembros también reciben
`ORCA_WORKTREE_SLUG` para mantener separadas las suites de tests en paralelo
([patrón](../worktree-test-resources.md)). El estado contiene:

- `config`, `sources`, `warnings`: las capas resueltas de arriba;
- `agents`: las filas de agentes del worktree (`working`, `waiting`, `idle`, `done`, la herramienta
  actual, la marca de líder y un `terminalHandle` opcional cuando el pane corresponde a una terminal de
  Orca). El botón **View** del panel Fleet (teclas `1`–`9` por orden de casilla) ejecuta `terminal focus`
  sobre ese handle; una fila sin él no recibe botón. Un líder también recibe cualquier otra sesión
  activa en esta máquina, sea cual sea su agente (Claude, Codex, OpenCode…) y en cualquier worktree o
  workspace de carpeta, como un miembro marcado `found: true` y con el nombre de su worktree
  ([selector](../../../src/main/runtime/orchestrator-game-found-sessions.ts)). Los demás líderes y sus
  miembros activos quedan fuera. Una sesión encontrada no ocupa hueco de la ola ni gana recompensas, y
  `sweep`, `push` y `stop --all` la dejan en paz; `game stop <ticket or name>` la cierra. Una sesión
  encontrada que corre en el worktree de un miembro que el líder guardó es ese miembro, recuperado
  con su nombre (ORCA-735);
- `review`: la revisión alojada para la rama, de cualquier proveedor soportado (GitHub, GitLab,
  Bitbucket, Azure DevOps, Gitea), con su estado de CI agregado. `verdict` (opcional) es la decisión
  de revisión del host: `approved`, `changes_requested` o `review_required` (solo GitHub; ausente si no
  hay decisión). Las revisiones de GitHub también llevan, leídos juntos en una sola consulta GraphQL por
  versión del PR: `ciHistory` (`{ headSha, ci }` por cada head empujado, del más antiguo al más nuevo,
  incluidos los heads que reemplazó un force-push), `commentCount` (hilos de comentarios de revisión;
  los comentarios de la conversación quedan fuera, ya que ahí publican los bots) y `reopenCount`. Otro
  proveedor, un repositorio ilegible o una lectura fallida dejan fuera los tres. `perfectMerge`
  (opcional) es la decisión de merge perfecto que lee el arcade (ver [El merge perfecto](#el-merge-perfecto));
- `workItem`: el elemento vinculado con un estado en vivo para Plane, Linear, Jira, GitHub y GitLab, y
  un `statusGroup` (`backlog`, `todo`, `in_progress`, `review`, `done`, `cancelled`, `unknown`) para
  que el juego nunca necesite conocer el tracker. `tracker: false` lo deja fuera;
- `links` (opcional): lo que la escena puede hacer clicable, cada uno
  `{ id, kind, provider, label, url, status?, tone? }`: `review`, `ci` (la página de checks de GitHub o
  de pipelines de GitLab de la revisión, cuando tiene checks), `workItem`, los enlaces `project` del
  proyecto y un enlace `activity` por cada URL distinta a la que apunta la actividad de los agentes.
  `tone` es `neutral`, `pending`, `success` o `danger`; toda `url` es `http(s)`;
- `activity` (opcional, en una fila de agente y arriba para el pane que llama):
  `{ name, id, url, at, running }`, la llamada MCP más reciente con la que coincidió una regla (ver
  [Enlaces del proyecto y actividad](#enlaces-del-proyecto-y-actividad)).
- `project` (opcional): `{ reviews, todo }`, mi trabajo abierto en todo el repo, no solo el de este
  worktree (ver [My PRs y To Do](#my-prs-y-to-do)). Cada lista es
  `{ provider, total, url, items }` o `null`; `items` contiene los 5 primeros como
  `{ id, title, url, status?, tone? }` y `url` abre la lista completa. `tracker: false` lo deja fuera.
- `stopped` (opcional): el STOP persistente del proyecto como `{ since, by }`, o `null` cuando está
  libre; uno cuyo estado no se puede leer es `{ since: null, by: null, unreadable: true }` y cuenta como
  activo (ver [El tablero compartido](#el-tablero-compartido-eventos-stop-e-inboxes)). Un host más antiguo no
  lo envía. El mod todavía no lo dibuja.
- `rewardWeights` (opcional): XP por tipo de recompensa después de aplicar todas las capas (ver
  [La tabla de puntuación](#la-tabla-de-puntuación-orchestratorgamerewardweights)). Un host más antiguo no lo
  envía y el mod otorga los valores predeterminados; el mod conserva solo los tipos conocidos con un
  número entero de 0 a 1000.
- `inboxes` (opcional, solo el líder): `{ key, unread, last }` por cada inbox, primero la del líder
  (`key: lead`) y después la de cada ticket, como mucho 20; `last` es `{ at, from, subject }` o `null`.

Un proveedor desconectado o sin autenticar solo deja fuera su propio campo. `links` y `activity` son
campos opcionales nuevos: un mod compilado antes de ellos lee el estado exactamente igual que antes, y
este mod conserva solo las entradas completas con una URL `http(s)` (como mucho 32 enlaces).

## Enlaces en la banda y en el panel Fleet

Cada enlace es un hipervínculo de terminal (OSC 8); Orca lo abre con Cmd/Ctrl-clic o desde su
popover de enlaces.

- **Chips de la banda**, después de los recuentos del equipo: la revisión (`#901 open`), su CI como
  chip propio (`CI failing`, en rojo, amarillo o verde), el work item (`CIN-123 In Progress`), cada
  actividad distinta de los agentes (`▶ Tambora TR-CIN-12` mientras corre su llamada, `Tambora TR-CIN-12`
  después) y los enlaces del proyecto (`↗ Test plan`). Cuando la banda es estrecha, los enlaces del
  proyecto se acortan y desaparecen primero, luego la actividad y luego el CI; la revisión y el work
  item se mantienen hasta el final. Un host que no envía enlaces dibuja la revisión con las palabras de
  su CI (`#901 open · CI failing`) como antes.
- **Needs you.** Una necesidad por CI fallido enlaza a la página de checks (a la revisión cuando no
  hay enlace de CI); la línea se recorta al ancho de la banda.
- **Panel Fleet.** Cada tarjeta de compañero muestra su actividad como un enlace bajo su estado,
  recortado a la tarjeta. Una fila **Open** admite teclas: `i` el work item, `o` la revisión, `c` el CI,
  `w` el primer enlace del proyecto, `a` la actividad del pane que llama (si no, la primera enlazada),
  `g` mis PRs y `t` mi To Do. Cada una ejecuta
  `orca tab create --url <url> --worktree id:<worktree> --json`, así que se abre en una pestaña del
  navegador de Orca del worktree en todas las plataformas, y un toast avisa cuando Orca no pudo. El
  menú mantiene `r` (Refresh) y `q` (Close); Pet es `p`.

## Disposición del Panel

Las secciones del panel Fleet son Team (las tarjetas y la tarjeta del advisor), Review (las filas de la
revisión y del work item), My PRs, To Do, Actions y Metrics, en ese orden. Un Panel nuevo muestra solo
Team y My PRs; las otras cuatro son widgets del catálogo que una persona añade desde el chip de menú
**Widgets** o con `/orca-game:layout add <section>`, y quita de la misma forma. En el catálogo, `●`
marca un widget visible y `○` uno en espera; un widget visible también recibe los chips `↑` y `↓` que
lo mueven. Cada encabezado empieza con una marca: `▾` mientras está expandido, `▸` una vez plegado a
su línea de encabezado (`▸ To Do 12`). Un clic, un toque o Tab y Enter sobre la marca lo alterna; cada
letra ya es una tecla del Panel, así que las secciones no reciben ninguna. Los encabezados conservan
su propio enlace o acción, y un Team plegado se pone rojo mientras un compañero espera; un Review
plegado conserva el color de su CI. Las líneas `Needs you` sobre las secciones nunca se ocultan.
En un pane del ancho de un teléfono, cada sección recibe además un chip de tamaño táctil bajo el
menú, y el catálogo es una fila de esos chips. El chip Widgets no tiene tecla: todas las letras y
dígitos ya están ocupados.

Un widget que no se muestra no se dibuja: sus filas, botones, teclas y las casillas animadas de Team
desaparecen hasta que se añade, y un widget Actions cerrado no lee ningún registro de ejecuciones. Sus
datos siguen llegando con `game state`.

El widget Metrics dibuja las `metrics` del estado (ver `orca game metrics` abajo) sin trabajo propio
por fotograma: un sparkline de PRs con merge por día con el total de la ventana y su primer y último
día, el lead time mediano, una línea tenue que nombra su origen y cuándo se leyó
(`GitHub ab2webco/orca-oss · updated 09:05`, sin el repo cuando no cabe; `Orca Game
events` cuando no se pudo leer el proveedor de revisión), y luego cada cuenta de Claude con `●` en la activa y dos medidores,
`5h` y `7d`, rellenados por octavos de celda, en amarillo desde el 75% y en rojo desde el 90%. En
ancho, una cuenta ocupa una fila; en un teléfono son dos, y los medidores se estrechan a dos celdas
para que ninguna fila se parta
([`metrics-widget.ts`](../../../resources/claude-plugins/orca-game/hooks/metrics-widget.ts)). El Panel de
un miembro, o uno en un host más antiguo, no recibe `metrics` y dice que los números están en el Panel
del líder. Una disposición de versión 1 se actualiza con Metrics en el catálogo, sin mostrarse.

`/orca-game:layout` lista las secciones con su estado y admite `reset`, `add <section>`,
`remove <section>` y `move <section> up|down` (también funcionan palabras en español: `añadir tareas`,
`quitar equipo`; los antiguos `show` y `hide` siguen funcionando). La primera vez que una persona abre
el Panel, un toast explica cómo plegar secciones.

La disposición se guarda en el `$.store` del mod bajo `panel-layout`: `{ version: 2, projects: {
<repoId>: { fleet: { order, collapsed, shown } } } }`, así que todos los worktrees de un mismo repo la
comparten y las demás personas conservan la suya. `shown` lista lo que dibuja el Panel; una sección que
añade una build posterior empieza en el catálogo. No se escribe nada hasta que la persona cambia la
disposición. Un valor de versión 1 se actualiza en la siguiente escritura, conservando todas las
secciones que dibujaba. Un valor dañado dibuja la disposición predeterminada; uno escrito por una build
más nueva se dibuja como la predeterminada y nunca se sobrescribe (ver
[Migraciones de datos del juego](../game-data-migrations.md)). Los ajustes de vista posteriores van en la misma
clave, junto a `fleet`.

## My PRs y To Do

La banda también muestra dos chips de todo el proyecto, para que un líder en `main` sin PR propio siga
viendo el trabajo abierto del equipo. Ambos se leen en el proceso principal y se guardan en caché
durante 90 segundos por repo y origen, así que el sondeo nunca multiplica las llamadas a GitHub o al
tracker ([lector](../../../src/main/runtime/orchestrator-game-project-work.ts)).

- **`⇄ #471`**: cada uno de mis PRs abiertos en GitHub (`author:@me is:pr is:open`), hasta 3, como un
  chip propio que abre ese PR. Un fork se busca con su remoto `upstream`, ya que el trabajo propio vive
  en el fork y las contribuciones en upstream; la lista abre entonces una búsqueda sobre ambos. Cada
  chip se colorea según su CI (rojo si falla, amarillo si está en curso, verde si pasa). Los 5 primeros reciben su CI (una llamada de checks cada uno, en caché 60 segundos por `gh`). El PR propio del
  worktree se omite, ya que su chip de revisión ya lo muestra. Cuando hay más abiertos de los que
  dibuja la banda, o ninguno, **`⇄ My PRs N`** abre la lista del host con el peor color. En GitLab es
  **My MRs**, los merge requests abiertos del proyecto.
- **`☐ To Do N`**: mis tickets abiertos. Los elementos hechos y cancelados se omiten. Abre la vista
  "asignados a mí" del tracker.

De dónde sale el To Do, gana la primera coincidencia:

1. `orchestratorGame.todo` en los Settings del proyecto o en `orca.yaml`:

   ```yaml
   # orca.yaml
   orchestratorGame:
     todo:
       provider: plane # plane | jira | linear | github | gitlab
       project: e665c0d5-22e7-495e-9ecf-3effee3ae370 # optional: Plane project id, Jira key, Linear team key
       workspace: ab2web # optional: Plane workspace slug, Jira site id or Linear workspace id
       action: jira # optional: the command or id of an action the To Do link runs instead
   ```

   Con `action`, el chip To Do, el encabezado To Do del Panel y su enlace `t` ejecutan esa acción
   (una de las `actions` del proyecto por su `command` o id, o un botón del líder como `lead:status`)
   en lugar de abrir la lista del tracker, así que el líder muestra el To Do con lo que use el proyecto
   (una CLI, un servidor MCP). Una acción que no existe se informa en `orca game state`
   y el enlace abre la lista como antes.
   La lista de PRs admite la misma clave, `orchestratorGame.reviews.action` (por ejemplo
   `reviews: { action: prs }`): el chip **My PRs**, el encabezado My PRs del Panel y su enlace `g`
   ejecutan entonces esa acción en lugar de abrir la lista de GitHub o GitLab.
   Sin `workspace`, Orca usa el workspace o sitio seleccionado en su página Tasks. `todo: off`
   oculta el To Do y mantiene los PRs. Un `project` de Jira debe ser una clave de proyecto (`CIN`),
   ya que va dentro del JQL.

2. El proyecto de Plane desde el que se lanzó este repo por última vez en la página Tasks.
3. El tracker del elemento vinculado al worktree (un elemento de Jira o Linear se limita al prefijo de su clave).
4. Los issues asignados a mí en el GitHub o GitLab del repo.

El panel Fleet lista ambos, cada elemento un enlace coloreado según su CI o su estado, con las teclas
`g` (lista de mis PRs) y `t` (lista To Do). `/orca-game:demo` los muestra con datos falsos. Un proveedor
que falla solo cuesta su propio chip.

## Acciones: botones y comandos slash

Un proyecto da a su líder hasta 6 botones ([`orchestrator-game-actions.ts`](../../../src/shared/orchestrator-game-actions.ts)).
Cada uno envía al líder un prompt como un turno o ejecuta una herramienta MCP desde el propio mod, y
`command` también lo ofrece como `/<command>`:

```yaml
# orca.yaml
orchestratorGame:
  actions: # at most 6; a later layer replaces the whole list
    - label: Test runs # at most 24 characters
      command: test-runs # optional: /test-runs; lowercase, digits and -, up to 24 characters
      key: x # optional: its Panel hotkey, one letter or digit
      prompt: Have members run the Tambora test runs of my QA tickets and report pass/fail.
    - label: Runs
      mcp: { server: tambora, tool: list_test_runs, args: { project: CIN } }
```

- **Prompts**: pueden usar los placeholders de los enlaces; uno sin valor en este worktree se omite.
- **Botones del líder.** El líder también recibe primero los cinco propios de Orca: Wave, Status, Push,
  Sweep y Stop (`/wave`, `/status`, `/push`, `/sweep`, `/stop`), cada uno un prompt que le pide ejecutar
  el verbo correspondiente de `orca game` ([`orchestrator-game-lead-actions.ts`](../../../src/shared/orchestrator-game-lead-actions.ts));
  Stop ejecuta `game stop --all --hold`, así que además mantiene el STOP del proyecto.
  Un miembro no recibe ninguno. `orchestratorGame.orchestrator.actions: false` los desactiva; una acción
  del proyecto cuyo comando ya usa un botón del líder conserva su botón sin el comando.
- **Dónde aparecen.** La banda dibuja una fila de chips (`▸ Ola`, `▸ Estado`… en el idioma de la
  sesión; el resto detrás de `+N`), y el Panel una fila Actions donde cada botón es `key: label`. La
  `key` de una acción es suya; las teclas del Panel (`r p q`, `g t i o c w a`, `1`–`9`) y una tecla que
  ya tomó otra acción se descartan con una advertencia, y el botón sigue funcionando. Una acción sin
  tecla toma la siguiente letra libre de `e f h j k l m n s u v x y z b d`. Escribirle al líder sigue
  funcionando como antes.
- **Comandos slash.** El mod registra cada comando después de un refresco y otra vez cuando cambia la
  lista. Un nombre que Claude Code rechaza (su propio `/status`, por ejemplo) se omite y se anota una
  vez; el botón sigue funcionando. El texto después del comando se añade al prompt: `/wave CIN-1,CIN-2`.
  Un comando MCP responde con las líneas de la herramienta.
- **Settings.** La sección **Actions** del proyecto muestra la lista de `orca.yaml` en solo lectura;
  **Edit on this machine** inicia la lista de esta máquina (etiqueta, comando, prompt o servidor MCP,
  herramienta y argumentos JSON, comprobados por el mismo parser), que reemplaza entera la de
  `orca.yaml`. **Inherit from orca.yaml** la descarta.

## El líder del proyecto: `orchestratorGame.orchestrator`

Un líder es una sesión que coordina y nunca trabaja un ticket: cada ticket va a un miembro en su
propio worktree y pestaña, que reporta de vuelta mediante la orquestación de Orca. Las claves se
resuelven una por una a través de las mismas capas ([`orchestrator-game-lead.ts`](../../../src/shared/orchestrator-game-lead.ts));
los Settings del proyecto editan todas salvo los dos prompts, `rules` y `mcpServers`, que viven en
`orca.yaml` (**Lead buttons** es `actions`).

```yaml
# orca.yaml
orchestratorGame:
  orchestrator:
    autostart: true # a plain session in this project starts as the lead
    cap: 4 # members running at once, 1 to 100; launches past it are refused. Unset: one per 4 GB of memory and 2 cores, at least 1 and at most 12. With a paired host, the ceiling over every host's cap (below)
    agent: claude # what a member runs, as `orca orchestration worker-start --agent` names it
    model: opus # optional
    effort: high # optional, used only with a model
    label: Orquestador # optional: the lead's name
    launchPrompt: | # optional: what a new member is told; {id} {title} {url} {status}
      Implement {id}: {title}
    pushPrompt: | # optional: what `game push` sends a stopped member; same placeholders
      Continue {id} to the end on your own. Report to your lead when it is done or when only the person can decide.
    rules: Members report TERMINADO CIN-NNN. # optional: appended to Orca's own rules
    actions: false # optional: hide Orca's lead buttons and their slash commands (on by default)
    accounts: default # optional: auto (unset: the freest managed account, see below), default (Orca's own selection), or a list of allowed account emails or ids
    askBeforeResume: true # optional: ask the person before resuming paused members (resumes at once by default)
    memberGame: false # optional: launch members as plain Claude, without their member band (on by default)
    memberNames: [Mario, Luigi, { en: Peach, es: Melocotón }] # optional: replaces the scene's roster
    mcpServers: [tambora, claude.ai Gmail] # optional: MCP servers every member needs
```

Un placeholder sin valor queda vacío; uno desconocido descarta la clave con una advertencia.

`mcpServers` hace que `game launch` y `game wave` comprueben, antes de crear nada, que el host y la
cuenta en que correría un miembro cargan cada servidor listado, y se niegan nombrándolo cuando falta
uno (`mcp_servers_missing`). El host lee la configuración que lee el Claude de esa cuenta, así que
`--on <host>` responde por el host, y `--account` o `auto` por el vault de esa cuenta
([`orchestrator-game-member-mcp.ts`](../../../src/main/runtime/rpc/methods/orchestrator-game-member-mcp.ts)).
Un servidor cuenta cuando está en los `mcpServers` de ámbito de usuario de esa configuración, en un
plugin de usuario habilitado o en el `.mcp.json` del repo. Un conector de claude.ai cuenta cuando la
cuenta lo conectó alguna vez, así que `Gmail` y `claude.ai Gmail` coinciden ambos. La comparación
ignora mayúsculas y minúsculas. El lanzamiento imprime `Warning:` y sigue cuando el host no puede
saberlo: un miembro Codex, un repo por SSH, un vault de WSL o un host emparejado cuyo Orca es anterior
a `game.member-mcp-servers.v1`. `--skip-mcp-check` lanza sin leer nada.

Cada miembro que inicia `game launch`/`game wave` recibe el primer nombre del roster que no tenga
ningún miembro vivo: `memberNames`, o si no el `roster` de la escena activa (cada escena incluida trae
uno), en el `ORCA_GAME_LOCALE` del pane del líder. El nombre va antes del ticket
(`Merlin · CIN-12 Cartelera`), así que llega al título de la pestaña, a `game fleet`, al HUD y a la
tarjeta del miembro. Se libera cuando el miembro se libera, y un lanzamiento que falla lo devuelve de
inmediato: un inicio rechazado, un host que informa que el inicio falló, o un registro guardado o remoto
que quedó en `failed` no retiene ningún nombre. Un nombre numerado (`Merlin 2`) aparece solo cuando todo
el roster está ocupado; un miembro recibe solo su ticket cuando la escena no tiene nombres
([`orchestrator-game-member-names.ts`](../../../src/shared/orchestrator-game-member-names.ts)).
**Member names**, en los Settings del proyecto, toma nombres simples separados por comas. Un miembro
en un host emparejado (`game launch --on`) toma su nombre del mismo conjunto: el Orca del líder lo
elige y lo guarda en el título de la tarea en casa. La Run DB de casa no registra el proyecto, así que
los nombres de sus miembros remotos no liberados solo retienen mientras quede otro nombre libre: ceden
antes de que un lanzamiento numere un nombre.

Los verbos del líder, ejecutados desde la terminal del líder
([`orchestrator-game-fleet-verbs.ts`](../../../src/shared/orchestrator-game-fleet-verbs.ts)):

- `orca game lead` — las reglas permanentes que convierten esta sesión en el líder (ninguna para un
  miembro).
- `orca game lead --fresh` — rota el líder: con el pane del líder saliente cerrado, Orca retira la
  conversación de líder guardada del proyecto y esta sesión pasa a ser el nuevo líder en lugar de
  reabrirla. Un líder vivo sigue ganando, y un host más antiguo que descarta el flag reabre el
  anterior y lo dice.
- `orca game launch` y `orca game wave` imprimen `Warning:` en stderr cuando los PR abiertos del
  proyecto (el total de la lista de PR) alcanzan el tope, y aun así inician el miembro: lleva
  primero esos PR hasta el merge. Un PR cuenta incluso después de que su miembro fue liberado, algo
  que el recuento de miembros vivos no puede ver.
- `orca game launch <ticket> [--repo <selector>] [--on <host>] [--prompt <task>]` — un miembro para
  un ticket; `--repo` lo inicia en otro repo del proyecto, y `--on` en un host emparejado (consulta
  la sección de la flota más abajo; `--repo` es entonces el repo del host y es obligatorio). `--prompt` reemplaza `launchPrompt` para ese
  miembro (mismos placeholders), para una tarea que no es implementar el ticket: una corrida de QA o
  de tests, una investigación. Sobrescrituras por lanzamiento de la configuración del líder (también
  en `game wave`, para cada miembro que lanza):
  - `--agent <id>` — cualquier agente que Orca conozca (`claude`, `codex`, `gemini`, …); un id
    desconocido se rechaza. Un agente distinto del del líder no hereda el `model`/`effort` del líder.
  - `--model <id>`, `--effort <level>` — los mismos valores que toman `orchestrator.model`/`effort`;
    `--effort` necesita un modelo.
  - `--account <email|id|auto>` — la cuenta gestionada en la que corre el miembro, asignada a
    `--claude-account` o `--codex-account` de worker-start según el agente. Solo `claude` y `codex`
    tienen cuentas gestionadas; la cuenta de otro proveedor, o una cuenta para cualquier otro agente,
    se rechaza. `auto` es la elección descrita más abajo. El resultado nombra el agente y la cuenta.
  - Un fallo de red del lanzamiento (runtime no disponible o tiempo agotado) se reintenta dos veces,
    con 1 s y 3 s de separación, con el mismo id de solicitud de orquestación, así que el runtime
    nunca inicia un segundo miembro para un mismo lanzamiento ([`orchestrator-game-launch-retry.ts`](../../../src/cli/handlers/orchestrator-game-launch-retry.ts)).
    Un miembro lanzado con `--on` corre en las cuentas propias del host (ORCA-798): la casa envía el
    `--account <email|id|auto>` escrito, o `auto` salvo que el proyecto fije `accounts: default`
    (ORCA-891), con la lista del proyecto si la hay. El host lo resuelve contra su propio roster igual
    que un lanzamiento local (consulta Cuentas). Solo un host sin cuenta gestionada para el agente, y
    sin lista, corre `auto` en su login global, un miembro a la vez (`global_login_taken`), y el
    resultado lo dice (`globalLogin`, `globalLoginHost`). Un host anterior a
    `orchestration.federation-member-account.v1` rechaza un `--account` escrito, y con la política
    sin fijar mantiene su login global (`globalLoginOlderHost`); uno anterior a
    `orchestration.federation-member-account-allowed.v1` rechaza el `auto` de una lista nombrándolo.
    `orchestration worker-start --on` sigue rechazando `--claude-account` y `--codex-account`.
  - Un miembro iniciado con un modelo o un esfuerzo — de estos flags o del `model`/`effort` del
    líder — recibe `ORCA_AGENT_MODEL_PINNED=1` y/o `ORCA_AGENT_EFFORT_PINNED=1` en el env del proceso
    de su agente, para que un enrutador de modelos fuera de Orca pueda respetar esa elección (Jev
    0.13.1+ los honra solo en panes del juego). Lo mismo
    vale para cada agente y cada lanzamiento que pide un modelo o un esfuerzo
    (`orchestration worker-start --model/--effort`, un modelo elegido en el compositor): Orca fija un
    pin solo para un valor que se le pidió y que aplicó, nunca para un valor por defecto del catálogo
    que completó él mismo (el esfuerzo de Codex) ni para uno que los argumentos de agente propios del
    usuario sobrescriben
    ([`agent-launch-pin-env.ts`](../../../src/shared/agent-launch-pin-env.ts)). El env viaja por el mismo
    canal que el env por agente de Settings, así que también llega al proceso remoto de un miembro
    por SSH; una sesión reanudada no se vuelve a fijar, ya que Orca no repite los flags de modelo del
    lanzamiento al reanudar. Con `worker-start --on`, el servidor conectado construye el lanzamiento,
    así que solo fija pins a partir de una versión que tenga esto.
- `orca game fleet` — el ticket, estado, PR, CI, rama, agente, cuenta, fase
  (`needs-you`, `limited`, `working`, `idle`, `finished`) y siguiente paso de cada miembro, con los huecos libres. Un miembro está **finished** cuando su PR
  tiene merge y su ticket está en revisión o hecho (o no tiene ninguno); todos los demás miembros
  cuentan para el tope, incluso uno cuyo turno terminó.
- **Topes por host (ORCA-888).** Con un entorno guardado, el tope del líder es la suma del de cada
  host alcanzable: el de este Orca a partir de su memoria y núcleos (uno por cada 4 GB y 2 núcleos, de
  1 a 12), el `memberCap` de cada host emparejado según `status.get`, en caché 30 s. El
  `orchestrator.cap` de una capa solo pone techo a esa suma. Un host que no responde no suma nada; uno
  más antiguo no publica tope, así que sus miembros ocupan los huecos de este Orca. `game fleet`
  imprime `Hosts: local 3/5 · imac 4/8`, `game state --json` lleva `hosts`, `game launch` se niega
  por host y nombra uno con espacio, y `game wave` y `game resume-members` inician miembros solo en
  este Orca. Un tope explícito por host todavía no tiene forma de fijarse.
- **Capacidad del host (ORCA-841).** `game fleet`, `game state` y el Panel dan entonces a cada host
  su propia línea: miembros frente a su tope, núcleos, memoria libre y carga, marcado `low memory`
  (menos de 4 GB o 10 % libre) o `busy` (carga igual a sus núcleos); `--json` los lleva en
  `hostCapacity`. Las cifras vienen del `diagnostics.memory` de cada host, así que un host más antiguo
  no necesita actualizarse, y se reutilizan durante 15 s ([`orchestrator-game-host-capacity.ts`](../../../src/shared/orchestrator-game-host-capacity.ts)).
- `orca game wave [<ticket>,...] [--repo] [--dry-run]` — lanza los tickets nombrados, o los items del
  To Do que siguen en To Do en el orden de la lista, hasta llenar los huecos libres. Salta los
  tickets que tiene un miembro y los tickets nombrados que ya están en revisión, hechos o cancelados;
  uno que ya está In Progress se lanza, ya que un proyecto puede moverlo ahí primero. `game state`
  lleva hasta 30 items del To Do, ordenados en progreso, QA, por hacer, así que conoce el To Do más
  allá de los que están en progreso; el Panel dibuja 3 por encabezado de estado y cuenta el resto en
  "+N more".
- `orca game sweep [--close]` — lista los miembros terminados y lo que deja cada uno (su worktree, un
  ticket aún no hecho). `--close` registra cada uno en `game history` y luego libera el dispatch de cada uno, o cierra su terminal cuando ningún
  dispatch es su dueño; una liberación no comprobada se reporta, y nunca le sigue un cierre. Deja los worktrees; las
  reglas del líder eliminan luego el worktree y la rama de cada miembro con merge mediante
  `orca worktree rm`; el worktree de un miembro en un host emparejado con
  `orca worktree rm --environment <host> --worktree <selector>`, no por ssh. Puede que el host ya
  haya eliminado él mismo un árbol con merge, lo que se lee como `No worktree on <host>
matches …` (ORCA-866).
- `orca game push [--dry-run]` — envía `pushPrompt` a los miembros inactivos; uno que espera una
  pregunta o un diálogo se reporta para la persona o el líder, y los que trabajan se dejan en paz.
- `orca game member <ticket|handle|character>` — un miembro en una sola lectura, acotada para caber en un turno
  del líder ([`orchestrator-game-member-report.ts`](../../../src/shared/orchestrator-game-member-report.ts)).
  **Now**: estado, fase, última herramienta, actividad vinculada, un límite de uso y sus últimas 20
  líneas de terminal sin códigos de escape. **Since launch**: cada dispatch de su tarea (reintentos
  incluidos), los últimos 10 mensajes entre él y el líder (preguntas, respuestas, cuerpos de
  `worker_done`, 600 caracteres cada uno), sus últimos 10 commits desde la base, PR, CI y estado del
  ticket. Una parte que Orca no puede leer esta vez se lista en `notes` y el resto se imprime igual.
  Las reglas del líder le piden leer esto antes de decirle cualquier cosa a la persona sobre un
  miembro. Un nombre de personaje lee ese personaje: su miembro, si hay uno corriendo, más lo que el
  proyecto guardó de él (cuenta, host, tickets, PRs, resultados, tareas recientes), que sobrevive a los
  reinicios y a un líder nuevo. Sin miembro corriendo imprime solo lo guardado.
- `orca game history [--ticket <id>] [--character <name>] [--since <date>]` — los miembros del proyecto
  ya liberados, del más reciente al más antiguo: ticket, repo, rama, personaje, agente, cuenta, host, hora
  de lanzamiento y de fin,
  resultado (`merged`, `qa`, `stopped`, `failed`, `limited`), PR y último reporte.
  `game sweep --close` y `game stop` escriben el registro de un miembro antes de liberarlo; si el host
  no puede recibirlo (un Orca sin historial), el miembro se libera igual y el resultado dice
  `history not recorded: …`. Los registros viven en el host de Orca que ejecuta el líder, un archivo
  por proyecto (el repo del worktree del líder, así que también proyectos SSH y de carpeta) dentro de
  la carpeta de datos de la app, `orchestrator-game-history/`, y conservan los últimos 200
  ([`orchestrator-game-history-store.ts`](../../../src/main/runtime/orchestrator-game-history-store.ts)).
  Se escriben mediante `game.historyRecord` y se leen mediante `game.history`, dos métodos RPC que un
  host más antiguo que esto no tiene; `game history` dice entonces que actualices Orca.
- `orca game adopt-history --from-repo-id <id>` — los datos del juego se guardan bajo el id del repo,
  y un repo quitado y agregado de nuevo recibe otro, así que su historial, eventos, personajes,
  lecciones y STOP quedan bajo el id viejo mientras el juego lee un proyecto vacío (ORCA-1011). Esto
  los integra en el proyecto actual: registros y eventos fusionados por fecha, personajes y conteos de
  lecciones sumados, un STOP que sigue puesto. Los archivos viejos se renombran
  `<name>.adopted-<time>` junto a cada store, nunca se borran, así que una segunda corrida no encuentra
  nada. Rechaza un id de repo que Orca todavía tiene, y solo corre cuando ningún lead ni miembro de
  ninguno de los dos ids está vivo, desde una terminal de Orca en el proyecto, en el host del lead. Los
  miembros guardados, la conversación del lead y los drops no se traen: nombran worktrees del id viejo.
- `orca game metrics [--since <date>] [--until <date>] [--ticket <id>] [--character <name>]` — los números de entrega
  del proyecto, calculados del lado del cliente a partir de los almacenes completos `game.events` y
  `game.history` (sin RPC nuevo, así que también responde un host más antiguo): tickets hechos (un
  evento `merged`, o un miembro liberado como `merged` o con un PR con merge), lead time por ticket
  desde su primer `claimed` hasta su último merge (recurriendo al `launchedAt` del historial, que está
  en UTC; un ticket sin evento `merged` termina cuando se liberó su miembro, marcado
  `ends when freed`), miembros liberados por resultado y recuentos de eventos. Las métricas cuyo hecho
  todavía no se registra (first-time-green, retrabajo, tamaño del PR, limpieza, deriva del tracker,
  XP, logros) imprimen `not recorded` con lo que necesitan, nunca 0; una nota indica cuándo el tope de
  un almacén (500 eventos, 200 registros) ya no alcanza el inicio de la ventana. `--character <name>`
  lee los personajes guardados del proyecto mediante `game.characters` (solo entonces, así que las
  métricas simples siguen funcionando contra un host más antiguo) y conserva las tareas propias de ese
  personaje, las últimas 20 que guarda su progreso: los resultados cuentan sus tareas, los eventos son
  los de sus tickets, y un ticket está hecho solo cuando lo está su propia tarea en él, así que un
  ticket que detuvo y al que otro personaje le hizo merge no se le acredita. El lead time sigue
  corriendo desde el primer claim del ticket. Añade el nivel y la XP del personaje, quita la XP de
  `not recorded` e indica cuándo las tareas más antiguas ya no se conservan. Un nombre desconocido se
  rechaza junto con los conocidos ([`orchestrator-game-metrics.ts`](../../../src/shared/orchestrator-game-metrics.ts)).
  Sin filtro, también imprime la ventana del widget de métricas de la escena de los últimos 14 días,
  en `--timezone <zone>` (por defecto, la zona de esta máquina), y su `Source`. Los días vienen del
  proveedor de revisión mediante `game.delivery` (ORCA-950): los PR del repo con merge por día
  calendario y su tiempo mediano desde que se abre el PR hasta el merge, tal como los reportan la
  búsqueda de GitHub (`is:pr is:merged merged:>=…` sobre el repo `origin` que enlaza My PRs del
  Panel, nunca el upstream de un fork) o las MR con merge de GitLab. Cuentan los merges por la merge
  queue o por `gh`, varios PR por ticket y los PR que no abrió ningún miembro, que los almacenes
  propios del juego no veían. Un host más antiguo que esto, un workspace de carpeta, un repo que no
  está en ninguno de los dos proveedores o una lectura fallida recurre a los almacenes del juego: cada
  ticket hecho cuenta una vez, el día de su `ticketsDoneAt` en `--json` (su último evento merged, o si
  no cuando se liberó su miembro), el lead time va del claim al merge, y `Source` dice que no se leyó
  el proveedor.
- El `metrics` opcional del estado del juego (solo para el líder, ausente en un host más antiguo o
  para un miembro) lleva ese mismo resumen de 14 días en la zona horaria propia del juego, su `source`
  opcional (`kind` github, gitlab o game, `repo`, `fetchedAt`, `partial` cuando el proveedor tenía más
  de 10 páginas de 100), más el uso de 5h y 7d de cada cuenta de Claude gestionada
  (la activa primero, luego las más ocupadas, como mucho 8, con lecturas que Orca ya tiene, nunca un
  refresco). La lectura del proveedor cubre 15 días para que una sola lectura sirva a cualquier zona,
  se guarda en caché por repo durante 5 minutos (25 mientras el presupuesto de GitHub está bajo), usa
  el bucket de búsqueda (30 por minuto, no core ni GraphQL), se detiene cuando ese bucket se agota y
  retiene el estado como mucho 4 s en una lectura en frío
  ([`orchestrator-game-delivery.ts`](../../../src/shared/orchestrator-game-delivery.ts)).
  El host lo calcula como mucho una vez por minuto por proyecto y zona; el presupuesto es de 2 KB de
  payload y 50 ms de cómputo sobre un almacén lleno, ambos probados contra una grabación de los
  almacenes reales de este proyecto ([`orchestrator-game-metrics-summary.ts`](../../../src/shared/orchestrator-game-metrics-summary.ts)).
- `orca game accounts [--refresh]` — cada cuenta gestionada por agente con su uso de 5h y 7d y su
  hora de reinicio, su situación (`free`, `near`, `limited`, `unknown`), cuándo vuelve a ser usable una
  que está cerca o limitada, los tickets de los miembros de este líder que corren en ella y si `auto`
  puede elegirla. Sin credenciales. `--refresh` pregunta primero a los proveedores; Orca lee el uso de
  una cuenta inactiva de forma perezosa, así que sin él una cuenta puede aparecer como `unknown`.
- `orca game move <ticket> [--account <email|id|auto>] [--dry-run]` — mueve un miembro a otra cuenta
  de su agente (`auto`, el valor por defecto, excluye aquella en la que está). Un miembro Claude se
  cambia en su propia terminal y reanuda la misma sesión mediante el cambio en el lugar de Orca
  (`orca account switch --terminal`); un miembro Codex se detiene y se vuelve a iniciar en su propio
  worktree en la nueva cuenta, vinculado al dispatch anterior con `--retry-of`. Cuando todas las demás
  cuentas están cerca o limitadas, nada se mueve y el resultado dice cuándo vuelve la primera.
  `--on <host> --repo <selector>` lo mueve en cambio a un host emparejado (ORCA-798): un miembro nuevo
  se inicia allí con `--account` o la política de cuentas del proyecto, resuelta por ese host; solo
  una vez que se inicia se detiene el dispatch anterior, sin liberación, así que el host anterior
  conserva su worktree y el resultado lo nombra. Cuando ese host tiene todas las cuentas cerca o
  limitadas, nada se mueve y el resultado indica cuándo vuelve su primera cuenta. Un miembro Claude
  que ya está en un host emparejado se cambia en el lugar allí (ORCA-916): `--account` y `auto` se
  resuelven contra las cuentas de ese host, emparejadas con la del miembro por email, y la máquina
  del líder necesita el host guardado como entorno. Cualquier otro miembro en un host emparejado solo
  se mueve con `--on`; `--account` por sí solo se rechaza para él.
- `orca game rebind <ticket>` — vincula un miembro a la terminal en la que corre después de que la
  suya fuera reemplazada fuera de Orca, por ejemplo por un cambio de cuenta hecho en su host
  (CIN-1297). La capacidad de su dispatch pertenece al pane y al proceso de la terminal anterior, así
  que el correo desde la nueva se rechaza por diseño. Por eso rebind cierra el dispatch anterior y
  vuelve a iniciar su tarea, vinculada con `--retry-of`, en la única terminal de agente viva del
  worktree del miembro que no tenga ningún otro dispatch vivo, en local o en su host emparejado
  (`--on`). Una shell simple ahí no es candidata. El dispatch anterior se detiene, o se abandona
  cuando no se puede comprobar ninguna detención porque su terminal ya no existe; abandonar no cierra
  nada. Se puede volver a vincular cualquier agente. El nuevo dispatch le da a esa terminal su propia
  capacidad, así que el correo y el Panel la siguen y la fila anterior desaparece. Nada cambia
  mientras la terminal propia del miembro siga corriendo, mientras el agente ahí esté a mitad de turno
  (vincúlalo de nuevo en su prompt), o cuando su worktree no tiene ninguna terminal de agente viva o
  tiene varias; el resultado las lista. Un miembro que ya no está en su host apunta a ello en
  `game fleet` y en View.
- `orca game adopt <name|ticket> [--force]` — convierte en miembro a un agente que `game fleet` lista
  como encontrado (un agente del repo de este proyecto que ningún líder lista, ORCA-943), en esta
  máquina o en un host emparejado. Ejecuta una tarea nueva en la propia terminal del agente con
  `worker-start --worktree id:<wt> --terminal
<handle>`, más `--on <host>` para un host emparejado, así que el correo del líder llega al agente y
  su estado, preguntas y worker_done llegan al líder actual. Esa ruta es una que todo host emparejado
  ya sirve, así que no hay cambio en el wire. La adopción se rechaza mientras el agente está a mitad
  de turno, para que el brief de adjunción nunca caiga en un turno en curso (pasa `--force` para
  adoptar de todos modos). También se rechaza cuando el agente lidera un Run en su host o su terminal
  ya no corre. Adoptar un agente que ya es miembro reutiliza su dispatch. Un agente encontrado local
  de otro repo nunca se adopta. Un agente descartado con `game drop` primero se trae de vuelta a la
  flota.
- `orca game drop <name|ticket>` — saca a un agente de la flota del líder sin detenerlo ni tocar su
  terminal ni su worktree (ORCA-943). El descarte se guarda por proyecto, según el host y el worktree
  del agente (un reinicio cambia su clave de pane, no esos), así que el agente queda fuera de
  `game fleet` y del Panel entre refrescos y reinicios, y su entrada de miembro guardada se elimina
  para que un reinicio no lo reanude, hasta que `game adopt` lo traiga de vuelta. Un miembro en esta
  máquina cuyo dispatch todavía reporta al líder se desvincula primero con
  `orchestration.workerDetach`: el dispatch se cierra como detenido (etapa `detached`), su capacidad y
  sus preguntas se cierran, y su terminal pasa a ser del usuario, así que ninguna liberación ni
  recuperación cierra el pane. Un miembro vivo en un host emparejado se rechaza, nombrando el host,
  ya que la detención de ese host cierra el pane allí.
- `orca game stop [<ticket>,... | --all]` — termina los miembros nombrados, o todos, para que ningún
  agente miembro siga corriendo: cada dispatch vivo se detiene y luego se cierra la terminal del
  miembro cuando la detención no la cerró (un dispatch detenido puede dejar su terminal retenida).
  Cada miembro se reporta como detenido, ya detenido o fallido; el líder y los worktrees nunca se
  tocan. `--all --hold` primero fija el STOP persistente del proyecto y luego detiene a todos los
  miembros; las reglas del líder le dicen que lo ejecute de inmediato cuando la persona detiene a
  todos ("detén todo y que no sigan").
- `orca game resume` — limpia el STOP, solo cuando la persona lo dice; no vuelve a lanzar nada.
- `orca game events [--ticket] [--since]`, `orca game event <kind> [--text]` y
  `orca game inbox [--ticket] [--unread] [--mark-read]` — el tablero compartido, más abajo. Las reglas
  del líder le piden leer los eventos y el inbox antes de responder "qué pasó".
- `orca game ask-owner --question [--ticket] [--option]... [--context]`, `orca game owner-questions
[--all]` y `orca game answer-owner <id> (--pick <n> | --answer <text>)` — las preguntas del líder a
  la persona como registros, más abajo.
- `orca game resume-members [<ticket>,...] [--discard] [--dry-run]` — trae de vuelta a los miembros
  que un reinicio dejó en pausa, más abajo.

### Decisiones, la espera y las reglas del dueño

El líder responde lo que preguntan sus miembros, y la persona solo se entera de lo que solo ella
puede decidir. Las reglas del líder ([`orchestrator-game-lead-brief.ts`](../../../src/shared/orchestrator-game-lead-brief.ts))
fijan el criterio:

- **La espera** incluye `decision_gate` junto a `worker_done`, `escalation` y `question`, así que un
  miembro que se bloquea en una compuerta llega al líder sin un segundo monitor.
- **Respuestas.** El líder responde a una pregunta o una compuerta con `orca orchestration reply`. Si
  eso falla, envía la respuesta al handle de terminal del miembro con `orca orchestration send --to`,
  y ejecuta `orca game push` cuando el miembro está inactivo. Cada respuesta se registra como
  comentario en el ticket del miembro.
- **La persona decide** las liberaciones y publicaciones, gastar dinero o cuota más allá del plan,
  acciones difíciles de revertir o que dan hacia fuera (force pushes a ramas compartidas, borrar
  trabajo, credenciales, visibilidad del repo), y el alcance o la dirección del producto. Todo lo
  demás lo decide el propio líder y lo registra en el ticket.
- **El advisor.** Cuando el agente del líder ofrece una herramienta de advisor, el líder la consulta una
  vez para una decisión técnica difícil, nunca para una actualización de estado. Sin ella, el líder
  decide según el criterio anterior.
- **Los miembros siguen trabajando.** Un miembro inactivo sin PR en curso es un fallo del líder: el
  líder le da su siguiente paso o libera su hueco.
- **Terminar antes de empezar.** El líder lleva cada miembro hasta el merge antes de lanzar otro
  ticket; los lanzamientos nuevos solo llenan huecos liberados por trabajo con merge. El líder elimina
  de inmediato el worktree y la rama de un miembro con merge, para que no se acumulen workspaces sin
  terminar ni con merge.

### Una instalación a la vez

El worktree nuevo de un miembro ejecuta la instalación del proyecto (`pnpm install` y similares).
Cuatro a la vez junto a cinco agentes forzaron el cierre de Orca Lab en un Mac de 16 GB (ORCA-746),
así que `game launch`, `game wave` y `game resume-members` (cuando necesita un worktree nuevo) le
piden a `orchestration.workerStart` que ponga el inicio en cola con `setupAdmission: 'queue'`
([`worker-setup-admission.ts`](../../../src/main/runtime/orchestration/worker-setup-admission.ts)):

- **Uno por host.** El host inicia un miembro de este tipo a la vez por host de instalación: esta
  máquina, o cada conexión SSH. El siguiente empieza cuando termina el comando de instalación
  anterior, cuando un agente que espera la instalación ve que terminó, de inmediato cuando el worktree
  no ejecuta instalación, o como mucho a los 20 minutos.
- **Memoria.** En esta máquina, el primero de la cola también espera a que haya espacio: macOS no debe
  reportar presión de memoria `warn` ni `critical`; en otros sistemas debe estar libre una quinta
  parte de la memoria física, al menos 2 GiB. La memoria de un host SSH es suya, así que aquí no se
  comprueba.
- **El lanzamiento vuelve de inmediato.** Un inicio en cola responde `state: 'queued'` con su lugar y
  lo que espera, y todavía no crea ningún dispatch, así que su tarea sigue lista. El host lo inicia
  más tarde por sí solo; si ese inicio falla, el líder recibe un mensaje
  `Queued start of <member> failed: <reason>`. `game launch` imprime
  `queued #<n>, waiting on <what>; it starts by itself` y no falla.
- **En el estado del juego.** Los miembros en cola son `queuedMembers`, nunca `pausedMembers`; un
  inicio que ocupa el hueco no es ninguno de los dos. Conservan su ticket y su hueco: `game launch`
  rechaza el ticket, `game wave` lo salta (`queued`) y `game fleet` los lista en
  `Queued behind a setup`.
- **Tras un reinicio** la cola desaparece, la tarea sigue lista y el miembro aparece en pausa;
  `game resume-members` lo vuelve a lanzar a la cola.
- **Versiones mezcladas.** El runtime anuncia `orchestration.worker-setup-queue.v1`; contra un host
  sin ella, la CLI dice que las instalaciones corren al mismo tiempo y lanza de inmediato, como antes.

### Miembros en pausa tras un reinicio

Cuando Orca Lab se cierra o la máquina se reinicia, el agente de cada miembro se detiene con ella. Los
miembros del líder se guardan mientras corren, así que el equipo retoma donde estaba:

- **Qué se guarda.** Un archivo por proyecto en el host de Orca que ejecuta el líder, dentro de la
  carpeta de datos de la app, `orchestrator-game-members/`
  ([`orchestrator-game-member-session-store.ts`](../../../src/main/runtime/orchestrator-game-member-session-store.ts)).
  Por ticket: nombre, run de orquestación, tarea y dispatch, worktree y rama, agente, cuenta
  gestionada, el id de conversación del agente y su último estado. `game launch` guarda el miembro
  antes de que arranque su worker y otra vez después, así que un lanzamiento interrumpido se sigue
  encontrando; cada lectura de `game state` del líder completa el id de conversación y el estado de
  cada miembro vivo
  ([`orchestrator-game-paused-members.ts`](../../../src/main/runtime/orchestrator-game-paused-members.ts)).
  Las escrituras se sincronizan con fsync antes del rename, ya que este archivo existe para el crash
  que haría perder uno normal.
- **En pausa.** Un miembro guardado que ahora no está vivo, y cuyo worktree no ejecuta ningún agente,
  está en pausa. `game state` le da al líder `pausedMembers`, y `game fleet` los lista en
  `Paused since Orca or the machine restarted`. Un miembro en pausa conserva su ticket y su hueco:
  `game launch` rechaza su ticket y `game wave` lo salta (`paused`), así que un ticket nunca recibe un
  segundo miembro. Un miembro cuyo PR tuvo merge o cuyo dispatch reportó éxito nunca queda en pausa, y
  `game sweep --close` y `game stop` olvidan a los miembros que liberan.
- **Worktree desaparecido.** Un miembro en pausa cuyo repo respondió sin su worktree guardado lleva
  `worktreeGone` ([`game-member-worktree-presence.ts`](../../../src/main/runtime/game-member-worktree-presence.ts));
  un repo que no se pudo escanear, como un host SSH sin conexión, nunca lo marca. Libera su hueco,
  `game fleet` lo lista en `Cannot resume, worktree gone`, y `game resume-members` lo reporta como
  `unresumable` con el comando `--discard`, sin vincular un run ni hacer fallar el código de salida,
  así que el inicio de un líder ya no lo reintenta (ORCA-832).
- **Reanudar.** `game resume-members` toma los miembros en pausa por turnos, uno a la vez y nunca por
  encima del tope ([`orchestrator-game-member-resume.ts`](../../../src/main/runtime/orchestrator-game-member-resume.ts)):
  - Primero vincula el run al que pertenecen sus tareas; nunca se apropia de ese run mientras este
    líder lidera miembros vivos en otro, y lo dice.
  - Un miembro Claude reabre su propia conversación (`claude --resume`) en su worktree, en la cuenta
    en la que corría, y Orca espera hasta que Claude esté arriba; cualquier otro agente, un
    lanzamiento interrumpido o una conversación que Claude no puede reabrir recibe un agente nuevo en
    la misma tarea en su worktree (un worktree hijo nuevo cuando no se creó ninguno). En ambos casos el
    miembro recibe un dispatch nuevo en su propia tarea, con un preámbulo nuevo, así que su
    `worker_done` y su correo llegan a este líder aunque la terminal del líder haya cambiado.
  - Un miembro cuya tarea se completó se reporta como terminado y se olvida; uno cuyo worktree o tarea
    ya no existe, o cuya tarea sigue marcada como despachada desde antes del reinicio, se reporta y se
    conserva, sin iniciar nada. Una tarea fallida o bloqueada se reintenta desde su dispatch más
    reciente.
  - Un lanzamiento interrumpido antes de que se guardara su worktree encuentra ese worktree mediante
    el registro de worker de su tarea, así que se reutiliza, nunca queda huérfano. Cuando el dispatch
    nuevo no se puede vincular, la conversación reabierta se vuelve a cerrar, para que no corra ningún
    agente sin un dispatch que sea su dueño.
  - Las reglas del líder le piden ejecutar `game resume-members` de inmediato y luego decirle a la
    persona quién se reanudó (ORCA-746). `askBeforeResume: true` (orca.yaml, o **Ask before resuming**
    en los Settings del proyecto) mantiene la regla anterior: preguntar una vez a la persona, nombrando
    a los miembros, antes de reanudar.
  - Un ticket se reanuda una sola vez aunque dos líderes lo pidan a la vez: una segunda llamada dentro
    de los dos minutos siguientes a la primera (el tiempo que tarda la CLI en vincular el nuevo
    dispatch) se rechaza con `already being
resumed`, así que nunca se reabren dos agentes en un mismo worktree. Cada host de Orca guarda esta
    reserva en memoria.
- **El brief del líder** (ORCA-746). Cuando se reanuda o se compacta la conversación propia de un
  líder, el mod orca-game le entrega `game fleet` como contexto, miembros en pausa incluidos, para que
  responda a partir del registro del host y no de un resumen; tras una compactación también le indica
  al líder que vuelva a `game lead` para sus reglas ([`lead-brief.ts`](../../../resources/claude-plugins/orca-game/hooks/lead-brief.ts),
  el `SessionStart` de Claude con `source` `resume` o `compact`). Solo lo recibe una sesión que
  ejecutó las reglas del líder, es el líder del proyecto y no tiene otro líder vivo; un inicio desde
  cero lee la flota mediante la skill del líder. Un líder reanudado también vuelve a ejecutar la skill
  del líder: un reinicio mató su observador de reportes, y sus reglas entonces reanudan a los miembros
  en pausa o preguntan primero.
- **Líderes anteriores** (ORCA-728). Una restauración puede traer de vuelta varias sesiones que alguna
  vez ejecutaron las reglas del líder; solo el líder registrado sigue liderando. Durante dos minutos
  después de cargar el roster, un líder registrado cuyo pane no se ha reconectado sigue liderando:
  `leadElsewhere` lo nombra en cuanto su pane tiene un handle, y un reclamo de `game lead` espera
  hasta 20 s a que se asiente antes de reabrir la conversación guardada o tomar el proyecto
  ([`orchestrator-game-leads.ts`](../../../src/main/runtime/orchestrator-game-leads.ts)). Un líder
  anterior reanudado o compactado se desmarca, se le dice qué pane lidera y que detenga su observador
  de reportes, y un toast nombra ese pane.
- **Descartar.** `--discard` libera a los miembros nombrados, o a todos; los worktrees nunca se tocan.
- **Sus worktrees están protegidos** (ORCA-746). `orca worktree rm` (`worktree.rm`) rechaza el
  worktree de cualquier miembro guardado que no haya terminado, en pausa o vivo, incluso con
  `--force`, que solo omite la comprobación de árbol sucio. El rechazo (`game_member_worktree`) nombra
  al miembro y lista hasta 20 commits que ningún remoto tiene, y luego dice cómo reanudarlo o
  descartarlo con `--discard`; `--force-member` lo elimina de todos modos y devuelve la misma lista
  como advertencia
  ([`game-member-worktree-guard.ts`](../../../src/main/runtime/game-member-worktree-guard.ts)). El
  barrido de worktrees con merge (`config/scripts/merged-worktree-close.mjs`) nunca recurre a
  `git worktree remove` tras ese rechazo. El diálogo de borrado propio del escritorio no pasa por
  `worktree.rm` y no está protegido.
- **Un archivo que este Orca no puede leer** (dañado, o de un Orca más nuevo) nunca se lee como vacío
  ni se sobrescribe: Orca arranca normalmente, `game fleet` dice `Could not resume members: <reason>`,
  y no se guarda nada hasta que `game resume-members --discard` aparta un archivo dañado, conservando
  sus bytes, con un nombre `.unreadable-<time>.json`. Un archivo de un Orca más nuevo se deja donde
  está, así que volver a ese Orca lo sigue encontrando; actualizar Orca es la forma de reanudar esos
  miembros. Las claves desconocidas sobreviven a una reescritura (consulta [`game-data-migrations.md`](../game-data-migrations.md)).
- **Versiones mezcladas.** `game.memberRecord`, `game.memberResume` y `game.memberDiscard` son métodos
  RPC nuevos, y `pausedMembers`/`pausedMembersError` campos opcionales nuevos de `game.state`. El
  lanzamiento de una CLI más nueva contra un host más antiguo no guarda nada y lanza de todos modos;
  `game resume-members` ahí dice que actualices Orca.

### Cuentas y miembros limitados

`accounts: auto`, también cuando no está fijado (orca.yaml o **Member accounts** en los Settings del
proyecto), pone cada miembro nuevo que `game launch` o `game wave` inicia sin `--account` en la cuenta
gestionada de su agente con más cuota libre
([`orchestrator-game-account-pick.ts`](../../../src/shared/orchestrator-game-account-pick.ts)):

- El uso de una cuenta es su ventana viva más ajustada, 5h o 7d; una ventana pasada su hora de
  reinicio cuenta como vacía.
- Al 90 % o más de la ventana de 5h, o al 75 % o más de la de 7d, está **near** y se salta, igual
  que al 100 % (**limited**): el turno de un miembro puede quemar varios puntos de una ventana de 5h,
  y un miembro largo puede quemar 10 puntos o más de la de 7d, cuyo límite bloquea la cuenta durante
  días (ORCA-1028).
- Las cuentas a 5 puntos o menos entre sí empatan; el empate lo gana la que tiene menos miembros de
  este líder (incluidos los que el mismo `game wave` acaba de lanzar).
- Una cuenta sin lectura de uso es **unknown**, que significa no verificada, no libre: `auto` nunca
  lanza en ella (ORCA-1028). Cuando una es desconocida, Orca refresca el uso una vez (acotado a 20 s)
  antes de elegir; si entonces ninguna cuenta está libre y alguna sigue desconocida, el lanzamiento
  se rechaza nombrándolas, y `--account <email>` lanza en una de todos modos.
- En un host emparejado, `auto` completa una cuenta sin lectura en ese host con la lectura que el
  home tiene del mismo email, porque la cuota es de la cuenta, no del host; la lectura propia del host
  manda. Solo cruzan el email y las ventanas de 5h y 7d, y solo hacia un host que anuncia
  `orchestration.federation-member-account-readings.v1`.
- Solo se eligen cuentas de este host, no endpoints personalizados (cambian el modelo), cuyo inicio
  de sesión no falló. Un agente sin cuentas gestionadas lanza con su propio login.
- Una cuenta con alguno de sus miembros detenido por un límite (ver abajo) está **limited** hasta que
  ese límite se reinicie, digan lo que digan sus lecturas de 5h y 7d: un límite de gasto no aparece en
  esas lecturas (ORCA-896).
- `accounts: [a@example.com, acct_id]` restringe `auto`, `--account` y `game move` a las cuentas
  listadas (emails o ids); si ninguna es usable el lanzamiento se rechaza, nunca se mueve al login
  global. Settings solo puede sobrescribir la lista con `default` o `auto`.
- El lanzamiento imprime la cuenta elegida, su uso de 5h y 7d, y cada cuenta que saltó y por qué.
- Cuando todas las cuentas están cerca o limitadas, el lanzamiento se rechaza indicando cuándo vuelve
  la primera.
- Un lanzamiento nunca recurre al login global del host (`~/.claude`, `~/.codex`) mientras el agente
  tenga cuentas gestionadas: Orca no puede refrescar, hacer `game move` ni `account switch` de un
  miembro ahí (ORCA-809). Cuando ninguna es usable el lanzamiento se rechaza y dice que nombres una con
  `--account`. Sin ninguna cuenta gestionada, un miembro corre en el login global y el lanzamiento lo
  dice; un segundo se rechaza hasta que el primero desaparezca. `game fleet` muestra el ACCOUNT de un
  miembro así como `global login` (`globalLogin: true` en `game state` y `--json`; un host más antiguo
  no envía ninguno).
- `default` mantiene la selección de cuenta propia de Orca, que puede ser el login global. Un miembro
  colocado con `--on` sigue las mismas reglas en su host, a partir del roster de ese host (consulta
  `game launch` más arriba); el miembro de un host emparejado nunca cuenta contra el login global de
  este host.

Un miembro está **limited** cuando se detuvo (no `working`) y, o bien su cuenta tiene una ventana al
100 % que no se ha reiniciado, o su terminal muestra un mensaje de límite de uso del proveedor
mientras no se puede verificar que su cuenta haya vuelto por debajo de su límite (la misma guarda que
usa el cambio automático de Orca). Un mensaje de límite de gasto (`spend limit`, `/usage-credits`) lo
mantiene limitado incluso entonces, ya que ninguna lectura cuenta el gasto
([`orchestrator-game-member-limit.ts`](../../../src/shared/orchestrator-game-member-limit.ts)).
`game state` lo lleva como el `limit: { resetsAt }` del miembro, y la cuenta de cada miembro como
`account: { provider, id, email }`. `game fleet` muestra la fase `limited` con `game move` como
siguiente paso, `game push` lo deja en paz, y la tarjeta del Panel se pone roja con
`limited · back in 1h 30m` (en español `limitado · vuelve en 1h 30m`, y en los demás idiomas del
mod). Cada tarjeta lleva una etiqueta tenue `codex · ana@…`: el dominio del email nunca se muestra, y
el nombre se acorta, y luego desaparece, a medida que la tarjeta se estrecha. Si **Auto-switch** está
activado en Settings, puede que Orca ya haya movido por su cuenta un pane de Claude o Codex; si no,
las reglas del líder lo envían a `game move`, o a esperar el reinicio.

La cuenta de un miembro es la que reporta su Claude en ejecución, no solo la que Orca registró al
crearlo (ORCA-907). Cada envío de la línea de estado lleva el `CLAUDE_CONFIG_DIR` del pane; un vault
gestionado ahí nombra la cuenta que muestran `game fleet`, `game move`, el Panel y el relay de un host
emparejado, por delante del registro de creación del pane y del pin del worktree. Un envío de antes
de un cambio de cuenta ya no cuenta. Las ventanas de 5h y 7d de ese mismo envío deciden si ese
miembro está limitado cuando son más recientes que la lectura en caché de Orca, así que la tarjeta
coincide con la propia línea de estado del pane. Un miembro detenido cuyas últimas líneas piden
`/login` (`Not logged in`, un token OAuth caducado o revocado, el `sign in again` de Codex) es
`limit: { resetsAt: null, loggedOut: true }`: fase `needs-you` con
`log <email> in again (/login in its pane), or game move <ticket>`, la tarjeta dice
`logged out · /login in its pane`, y `game accounts` muestra su cuenta como sin sesión, que `auto`
salta. Un host más antiguo no retransmite `loggedOut`, y una casa más antigua muestra a ese miembro
como limitado.
Un turno que muere en ese aviso no dispara el hook Stop, así que su fila se queda en `working`
(ORCA-923). A un miembro en `working` cuyos hooks llevan 60 s en silencio también se le leen las
últimas líneas, y un aviso de `/login` ahí lo deja sin sesión con estado `waiting`. El host
retransmite ese estado en `agent`, que una casa más antigua ya lee como needs-you; un host más
antiguo sigue retransmitiendo `working`.

### La XP del líder

Un líder en la rama base no tiene PR ni ticket propios, así que su XP viene de sus miembros
([`fleet-rewards.ts`](../../../resources/claude-plugins/orca-game/hooks/fleet-rewards.ts)). Cada
refresco compara cada miembro de `game state` que corre en su propio worktree con el refresco
anterior, emparejados por el id de ese worktree:

| Evento                                             | Clave de recompensa | XP  |
| -------------------------------------------------- | ------------------- | --- |
| aparece un miembro (lanzado, o tomó un ticket)     | `member-claimed`    | 10  |
| el CI de su PR se pone verde                       | `ci-green`          | 20  |
| su ticket pasa a un grupo de revisión (QA, Review) | `work-item-review`  | 50  |
| su ticket pasa a hecho                             | `work-item-done`    | 70  |
| su PR tiene merge                                  | `review-merged`     | 100 |
| su PR con merge pasa a perfecto                    | `perfect-merge`     | 100 |

La XP es la de por defecto; un proyecto la cambia con `rewardWeights` (más abajo).

El primer refresco de una sesión no otorga nada, así que un miembro lanzado o un PR con merge
mientras el pane del líder estaba cerrado no gana nada. Un miembro que se va no gana nada más, y un
lanzamiento se identifica por el worktree del miembro, así que el mismo miembro que vuelve en un pane
nuevo no es un segundo lanzamiento. Las recompensas de revisión y de ticket usan los ids que el propio
pane del miembro le da al mismo cambio, así que cuando el líder y el miembro comparten una cuenta (el
almacén del mod es un archivo por carpeta de configuración de Claude) el registro lo cuenta una vez.
Un pane de miembro (`role: member`) solo gana por su propio trabajo. Los toasts nombran al miembro
(`+100 XP · ORCA-12 · #41 merged`), un merge hace flotar `#41 merged!`, y `rewards: false` lo apaga
todo. El evento `claimed` del tablero no está en `game state`, así que un lanzamiento se detecta por
la aparición del miembro ahí.

El merge es la excepción a "nada una vez que se va" (ORCA-887). El líder y la liberación automática
liberan a un miembro justo después de que su PR tiene merge, así que un refresco rara vez ve su
revisión pasar a `merged`. Cuando el `game state` de un líder lee la revisión de un miembro como
`merged`, el host primero escribe el evento `merged` del tablero con esa revisión: proveedor, número,
worktree y si `perfectMerge` era `true`. Solo después la liberación automática quita la fila
([`orchestrator-game-merge-record.ts`](../../../src/main/runtime/rpc/methods/orchestrator-game-merge-record.ts)).
El estado de un líder lista los 20 más recientes como `merges`. Un merge que aparece ahí entre dos
refrescos gana `review-merged` y, cuando es perfecto, `perfect-merge` y la oferta del arcade, con los
mismos ids que daría el cambio de la revisión, así que un merge visto y también registrado gana una
sola vez. Un host más antiguo no envía `merges`, y la primera lista que lee un pane no otorga nada. Un
merge registrado mientras no se podían leer los hechos de su revisión cuenta como no perfecto.

### La tabla de puntuación: `orchestratorGame.rewardWeights`

Cada recompensa viene de un hecho que Orca observa en dos sondeos de `game state`, nunca de lo que
reporta un agente (el cuerpo o el sobre de un `worker_done`, texto del chat), así que una afirmación
sin un hecho que la respalde no gana nada. Cada hecho es una fila del registro identificada por el id
del hecho, así que un reinicio, un segundo sondeo u otro pane que ve el mismo cambio no escribe una
segunda fila
([`rewards.ts`](../../../resources/claude-plugins/orca-game/hooks/rewards.ts)).

| Clave de recompensa | Se gana cuando                                       | Fuente del hecho                                     | Id del hecho                              | Por defecto |
| ------------------- | ---------------------------------------------------- | ---------------------------------------------------- | ----------------------------------------- | ----------- |
| `review-merged`     | la revisión del worktree pasa a `merged`             | `review.state` (proveedor de revisión alojado)       | `review-merged:<provider>#<n>@<worktree>` | 100         |
| `ci-green`          | el CI de la revisión pasa a `success`                | `review.ci` (checks agregados o pipeline)            | `ci-green:<provider>#<n>@<worktree>`      | 20          |
| `work-item-review`  | el work item vinculado pasa a un grupo de revisión   | `workItem.statusGroup` (tracker)                     | `work-item-review:<provider>:<id>`        | 50          |
| `work-item-done`    | el work item vinculado pasa a hecho                  | `workItem.statusGroup` (tracker)                     | `work-item-done:<provider>:<id>`          | 70          |
| `member-claimed`    | aparece un miembro de un líder en su propio worktree | `agents` (el id del worktree del miembro)            | `member-claimed:<worktree>`               | 10          |
| `perfect-merge`     | la revisión con merge pasa a perfecta                | `review.perfectMerge` (hechos de revisión de GitHub) | `perfect-merge:<provider>#<n>@<worktree>` | 100         |

`rewardWeights` fija la XP de una recompensa en un número entero de 0 a 1000; `0` apaga esa
recompensa (sin fila, sin toast) y una recompensa que se omite mantiene su valor por defecto. Un valor
no válido o una clave desconocida se reporta en `warnings` y esa recompensa mantiene su valor por
defecto ([`orchestrator-game-reward-weights.ts`](../../../src/shared/orchestrator-game-reward-weights.ts)).
Una fila conserva la XP con la que se escribió, así que un peso cambiado después solo se aplica a
hechos nuevos. `rewards: false` sigue apagando todas las recompensas. Un workspace de carpeta o un
worktree sin revisión ni tracker nunca ve esos hechos, así que sus recompensas nunca se disparan y no
se quita nada.

El registro también acepta filas que restan XP, para las señales de calidad que costarán puntos
(ORCA-686): el total puede bajar de 0 mientras el nivel se queda en 1, y el toast y la línea de
puntuación muestran el signo menos (`-30 XP`, en rojo en la línea de puntuación plana).

### El merge perfecto

`review.perfectMerge` es la compuerta de calidad del dueño (ORCA-686), y el arcade (ORCA-775) lo lee
para desbloquear una partida ([`orchestrator-game-state.ts`](../../../src/shared/orchestrator-game-state.ts)).
Está ausente hasta que la revisión es `merged` y se leyó cada hecho de GitHub de arriba, así que un PR
abierto, otro proveedor o una lectura fallida nunca cuenta como perfecto. Una vez con merge es `true`
solo cuando se cumple todo esto, y `false` en caso contrario:

- el CI es `success` y ningún head en `ciHistory` fue nunca `failure` (una corrida en rojo antes de un
  rebase sigue contando, leída de los eventos de force-push);
- la revisión no encontró nada que corregir: `verdict` no es `changes_requested` y `commentCount` es 0.
  `approved` no se exige, ya que el líder y sus miembros comparten una identidad de GitHub y un autor
  no puede aprobar su propio PR;
- `reopenCount` es 0;
- se cumple la aceptación del ticket. El host no tiene ningún hecho para eso, así que el merge la
  representa: el líder solo hace merge después de comprobar la aceptación.

Gana la recompensa `perfect-merge` además de `review-merged` cuando pasa a `true`, lo que puede ocurrir
un refresco después del merge, ya que los hechos se leen cuando el PR cambia.

**Subagentes del líder.** El líder orquestador es una sesión que ejecutó las reglas del líder:
`orca game lead`, ya sea mediante `/orca-game:lead`, el `autostart` del proyecto o una llamada Bash a
él. Solo esa sesión rechaza los subagentes `Agent` y `Task` de Claude Code (`classic.PreToolUse`,
[`lead-subagent-guard.ts`](../../../resources/claude-plugins/orca-game/hooks/lead-subagent-guard.ts)),
y el rechazo nombra `orca game launch`. Los compañeros de Agent Teams nunca se rechazan: una llamada
que nombra un `team_name` o un `name` es uno. No se rechazan un pane simple de Agent Teams que nunca
ejecutó las reglas del líder, un miembro, ni una sesión antes de ejecutar las reglas del líder. Un
subagente que corre en el líder orquestador cuenta como un compañero trabajando en la banda y en el
panel Fleet hasta que su turno se completa o pasa diez minutos sin hacer ninguna llamada ([`lead-subagents.ts`](../../../resources/claude-plugins/orca-game/hooks/lead-subagents.ts)).
El registro del líder es por sesión, los 50 más recientes ([`lead-started.ts`](../../../resources/claude-plugins/orca-game/hooks/lead-started.ts)).

## El tablero compartido: eventos, STOP e inboxes

Lo que un miembro hizo o preguntó sobrevive a su pestaña y a su cuenta, así que el líder puede
responder a partir de ello después de un reinicio. Todo esto vive en el host de Orca que ejecuta al
líder, por proyecto (el repo del worktree del líder, así que también en proyectos SSH y de carpeta);
las llamadas de un miembro llegan al proyecto de su líder aunque trabaje en otro repo (`--repo`),
porque el host lo resuelve a través del dispatch del miembro
([`orchestrator-game-board.ts`](../../../src/main/runtime/orchestrator-game-board.ts)). Cómo sobreviven
estos archivos a una actualización o a un downgrade, y con qué debe venir un cambio en ellos, está en
[`game-data-migrations.md`](../game-data-migrations.md).

**Eventos**: un registro de solo anexado, guardado en el mismo archivo por proyecto que `game history`
(`orchestrator-game-history/`), los últimos 500
([`orchestrator-game-events.ts`](../../../src/shared/orchestrator-game-events.ts)). Cada evento es
`{ at, kind, ticket, text, by }`, con `kind` uno de `claimed`, `pr_opened`, `merged`, `qa_handoff`,
`question_parked`, `failed`, `stopped`, `resumed`, y `by` `lead` o el ticket del miembro.

- `game launch` (y cada lanzamiento de `game wave`) publica `claimed` una vez que el miembro arrancó.
- `game fleet` y `game sweep` publican `merged` para un miembro cuyo PR se hizo merge y `qa_handoff`
  para uno cuyo ticket está en revisión. Cada uno lleva una clave (`merged CIN-1 #41`), y el tablero
  guarda un evento por clave, así que ejecutarlos en cada turno publica cada uno una sola vez (mientras
  la clave esté entre los últimos 500).
- `game stop --hold` y `game resume` publican `stopped` y `resumed` cuando cambian STOP.
- Un miembro publica los suyos con `orca game event pr_opened --text "PR #41"`; siempre publica bajo su
  propio ticket, diga lo que diga `--ticket`. Un proyecto pide a sus miembros `question_parked` y
  `failed` en su `launchPrompt`.
- Una publicación nunca hace fallar el comando que la hace: un Orca sin eventos simplemente no guarda
  ninguno.

**STOP**: un archivo por proyecto en `orchestrator-game-stop/`, separado del historial para que un
historial dañado nunca se lea como STOP ([`orchestrator-game-stop-switch.ts`](../../../src/main/runtime/orchestrator-game-stop-switch.ts)).

- Mientras está activo, `game launch`, `game wave`, `game push` y `game move` se rechazan antes de
  tocar nada, indicando cuándo y quién lo activó. Una ola lo vuelve a leer antes de cada
  lanzamiento, así que un STOP activado a mitad de la ola deja el resto sin lanzar.
- Falla de forma cerrada: un archivo que existe pero no se puede leer o parsear, o una lectura de STOP
  que falla durante una ola, cuenta como activo. Solo un archivo ausente significa libre.
- Solo el líder lo activa o lo desactiva; el intento de un miembro se rechaza, y al líder nunca se le
  rechaza, porque es donde se desactiva STOP. `game resume` informa que STOP sigue activo cuando el
  archivo no se puede eliminar.
- `game stop --all --hold` activa STOP primero y luego detiene a cada miembro. Un miembro que la
  detención no pudo terminar recibe un mensaje de orquestación urgente `STOP`. Si STOP no se puede
  activar (un Orca más antiguo, un error de escritura), los miembros se detienen igualmente y el
  resultado dice por qué, con código de salida 1.
- **Lo que Orca no impone.** A los miembros no se les rechazan llamadas a herramientas. El hook
  gestionado de Orca es de tipo fire-and-forget: nunca lee la respuesta del servidor de hooks, sale con
  0 ante cualquier fallo, y en SSH y WSL el relay reenvía los eventos en un solo sentido, así que un
  rechazo en PreToolUse necesitaría un nuevo endpoint de hook bloqueante, un hook de lanzamiento
  `--settings` solo para miembros y cambios en el relay, y aun así fallaría de forma abierta cada vez
  que el hook no pudiera alcanzar a Orca. Detener al agente del miembro (`game stop`) es lo que
  realmente termina su trabajo; STOP impide que el líder inicie o haga push de otro.

**Inboxes**: el correo de orquestación de Orca ya sobrevive a un miembro: los mensajes viven en el
`orchestration.db` del host y nunca se borran cuando se cierra una terminal, se detiene o libera un
dispatch, o se reinicia la app. `game inbox` lo lee por participante en lugar de por handle de terminal
([`orchestrator-game-inbox.ts`](../../../src/shared/orchestrator-game-inbox.ts),
[`orchestrator-game-inbox-source.ts`](../../../src/main/runtime/orchestrator-game-inbox-source.ts)):

- El inbox del líder es su terminal más el buzón de su run actual (`run:<id>`, donde llega
  `worker_done`); el de un ticket es cada terminal y buzón `dispatch:<id>` que tuvieron sus miembros
  en el run actual del líder, incluidos los cerrados. El ticket sale del título de cada tarea. Del más
  nuevo al más antiguo, los últimos 50; el correo más antiguo se queda en `orca orchestration inbox`.
- Un mensaje está sin leer hasta que el agente al que iba dirigido lo lee (`orchestration check`) o
  el cursor de lectura propio del tablero lo pasa. `--mark-read` mueve ese cursor y nunca marca como
  leído el correo de orquestación, así que el `orchestration check --wait` del líder sigue recibiendo
  cada mensaje.
- Una pregunta de un miembro que el líder no ha respondido sigue esperando al líder después de que se
  confirma su correo (ORCA-746 T6): `game fleet` muestra el NEXT del miembro como
  `waiting on you: orchestration reply --id <msg>` hasta que la pregunta se responde o se cierra, y
  `game state` la lista bajo el inbox del líder.
- Lo que el líder le pregunta a la persona es un registro, no texto de chat (ORCA-782): `game ask-owner`
  guarda la pregunta con su ticket, hasta 6 opciones, una línea de contexto y la hora en que se
  preguntó en el archivo del tablero del proyecto, junto a sus eventos ([`orchestrator-game-owner-questions.ts`](../../../src/shared/orchestrator-game-owner-questions.ts)).
  Las abiertas nunca se descartan; las últimas 200 respondidas se quedan para la auditoría.
  `game state --json` le da al líder `openOwnerQuestions`. `game answer-owner` (y más adelante el
  Inbox) responde una sola vez: el host escribe una `escalation` de `owner` a la terminal del líder,
  un tipo que el watch del líder deja pasar, y el líder la registra en el ticket. La misma respuesta
  otra vez no hace nada, una distinta se rechaza, y un miembro no puede ni preguntarle a la persona
  ni responder por ella.
- Los miembros que un líder coloca en un host emparejado con `orchestration worker-start --on <env>`
  forman parte de su flota (ORCA-824): `game fleet`, `game state --json` y `game member <ticket>` los
  listan con su host (`HOST`, `remote.host`), y el estado, la rama y el PR que informa el
  `federationShow` del host, con la herramienta que ejecuta el miembro (`toolName`), su informe de Jev
  (`advisor`) y el modelo que nombraron sus propios hooks, o si no, aquel con el que el líder lo lanzó
  (`launch.source` `session` o `launch`; ORCA-933). La tarjeta del Panel imprime ese origen
  (`◇ session …`, `◇ launch …`) cuando no hay informe de Jev, y un host más antiguo no retransmite
  ninguno de los tres, así que el equipo local recurre a su propio registro de lanzamiento. Un host
  que no responde en 3 s mantiene a su miembro listado con estado `unknown` y NEXT
  `worker-show --dispatch <id>`. La flota contiene los dispatches remotos vivos del Run del líder y
  los que terminaron desde que el líder actual reclamó el Run. Un agente remoto iniciado de cualquier
  otra forma (una terminal normal en el host) no tiene registro en la máquina del líder y no se puede
  listar; `orca game launch <ticket> --on <host> --repo <selector of the repo on that host>` es el
  lanzamiento remoto del juego: el mismo nombre de roster, título de tarea, registro de miembro y
  `game: true` que un lanzamiento local, enviado como `worker-start --on <host>` con un worktree
  `new-top-level`. El host inicia el pane como miembro del juego (banda y personaje) cuando tiene la
  capacidad game-member. El Orca del líder también envía el archivo de escena que dibuja el líder, tal
  como está escrito, a un host que anuncia `orchestration.federation-game-scene.v1`. El host lo guarda
  en el registro de attach del miembro y lo dibuja solo cuando el worktree del miembro no tiene un
  archivo de escena legible propio (`.orca/` suele estar excluido de git, así que a un worktree nuevo
  en el host le falta). Un host más antiguo dibuja su propia escena, o Quest. Un `worker-start --on`
  simple no le da al miembro ni nombre ni juego. Todavía no hay un mapa de repos del host, así que
  `--repo` nombra el repo propio del host.
- El watch del líder es `orchestration check --wait --watch`: una ventana tranquila vuelve a esperar
  en silencio y solo regresa con un mensaje, así que una hora inactiva no le cuesta al líder ningún
  turno (ORCA-746 T6b).
- A un lote que el check del líder entregó no se le vuelve a señalar ("You have N orchestration
  messages") hasta que el pane se reinicia; la entrega del watch es el único despertar para ese evento
  (ORCA-746 T6b).
- Mientras el watch del líder está pendiente, no se señala nada, ni siquiera el correo fuera de sus
  `--types`: ese correo va en el siguiente lote del watch, delante del mensaje que lo despierta
  (ORCA-824). Sin un watch pendiente, el correo del Run se señala como antes.
- `--types` filtra solo el tráfico propio del Run. El correo que no envió ningún miembro despierta el
  watch sea cual sea su tipo: la respuesta `status` de otro líder, el dueño. Un miembro es el handle
  asignado o el pane de cualquier dispatch del Run, el correo retransmitido de un miembro remoto
  (`dispatch:<id>`), o los avisos propios del runtime `task:`/`run:`; sus pings `status` siguen yendo
  en el siguiente lote sin despertarlo (ORCA-861).
- El buzón de un Run sobrevive a su líder, así que antes de que un check arme un lote (y antes de que
  cuente el puntero), el correo ya resuelto pasa al historial: una pregunta respondida o cerrada, o
  cuyo dispatch ya no existe; y un `worker_done`, una escalación o un status de un miembro terminado,
  enviados antes de que el líder actual reclamara el Run (ORCA-824). El check que los retiró lleva
  `retired: { count, unverified }` y la salida de texto lo dice en una línea; `unverified` lista los
  informes retirados cuyo PR no tiene merge ni está cerrado, para que el nuevo líder igualmente los
  verifique. `check --all` muestra el correo retirado.
- Un `worker_done` llega una sola vez: un segundo para el mismo dispatch (un envío reintentado, o el
  miembro y un observador enviando ambos su `TERMINADO`) se descarta del inbox y de su conteo.
- El setup de un worker que tiene éxito no envía correo (ORCA-746): se registra en el dispatch
  (`setup_state`, que muestra `orchestration worker-show`). Un setup fallido sigue enviando al run un
  `status` de alta prioridad. Los heartbeats nunca llegan al inbox, a su conteo ni a la línea
  "You have N orchestration messages" de la terminal.
- El fallo de un miembro (setup fallido, plazo de primera señal, salida del agente, `worker_done`
  fallido) sale del inbox y de su conteo una vez que el mismo ticket lo supera: un `worker_done`
  exitoso posterior, o cualquier mensaje de un dispatch más nuevo. El correo del propio dispatch
  fallido no lo oculta, salvo su propio aviso "member reattached".
- Un miembro envía un heartbeat cuando llega su brief y ningún bucle (ORCA-746): esa primera señal
  evita que el plazo de primera señal de 11 minutos haga fallar el dispatch. Después, Orca registra el
  `last_activity_at` del miembro cada 30 s a partir de los hooks de su agente (o de la salida de la
  terminal cuando el agente no tiene), y el aviso de inactividad del coordinador lee el heartbeat o la
  actividad, una vez por cada racha de inactividad. Un miembro federado o retransmitido por SSH cuyo
  PTY no está en este host no tiene actividad local, así que se le avisa como inactivo 10 minutos
  después de su último heartbeat: solo un aviso, nunca un fallo.
- A un miembro al que el plazo de primera señal hizo fallar pero cuya terminal sigue trabajando
  (ORCA-658) se le observa durante 30 minutos después de su última actividad. Una actividad posterior
  al fallo reabre el dispatch, desarmando el plazo ya gastado, así que su `worker_done` resuelve la
  tarea, salvo que la tarea se haya vuelto a despachar u otro miembro vivo tenga el ticket. Entonces
  sigue fallido. En cualquier caso el líder recibe un mensaje: "member reattached", o "orphaned member
  still working" (adopta su trabajo o detén esa terminal). El plazo sigue haciendo fallar un dispatch
  silencioso a los 11 minutos, ya que la actividad del host nunca lo desactiva por adelantado; un
  miembro federado no tiene actividad local que lo reabra. Mientras sigue trabajando, un miembro
  huérfano permanece en `game fleet` y `game member` (ya no desaparece 30 minutos después del fallo),
  con NEXT "orphaned, still working: adopt its work or stop it". La columna ACTIVE de la flota muestra
  la última actividad de cada miembro observada por el host.
- `game state` le da al líder `inboxes` con conteos de no leídos; un miembro solo lee su propio ticket.

**Versiones mezcladas.** El tablero agrega cuatro métodos RPC más nuevos que `game.history`: `game.events`,
`game.eventPost`, `game.stopSwitch` y `game.inbox`, y los campos opcionales `stopped` e `inboxes`
de `game.state`. Una CLI contra un host más antiguo pide actualizar Orca para `events`, `event`, `inbox` y
`resume`; los lanzamientos y barridos allí no publican nada y no ven STOP, ya que ese host no puede
guardar uno.

## Escenas integradas

El mod incluye cuatro conjuntos de arte ([`hooks/scenes/`](../../../resources/claude-plugins/orca-game/hooks/scenes)),
listados para Settings en `ORCHESTRATOR_GAME_BUILT_IN_SCENES`
([`orchestrator-game-config.ts`](../../../src/shared/orchestrator-game-config.ts)). Cada uno viste las
seis fases (working · docs · build · verify · PR · handoff) y firma tus mensajes con un narrador.

| Id          | Escena       | Mundo                                                        | Grupo por fase, luego narrador                                                      | Con CI en rojo          | Final del merge |
| ----------- | ------------ | ------------------------------------------------------------ | ----------------------------------------------------------------------------------- | ----------------------- | --------------- |
| `quest`     | Quest        | Montañas y colinas, sol o cielo nocturno                     | Squire · Sage · Blacksmith · Knight · Herald · Champion; Storyteller                | el miembro destella     | —               |
| `vigilante` | Night Watch  | Horizonte nocturno, azoteas, una señal en el cielo           | Night Watch · Detective · Gadgeteer · Mentor · Rooftop Run · Commissioner; Narrator | un bribón enmascarado   | `◆ CASE CLOSED` |
| `jrpg`      | Crystal Saga | Agujas de cristal bajo el día, el atardecer, tormenta, noche | Mercenary · Mage · Thief · Healer · Lancer · Hero; Chronicler                       | un espadachín rival     | `★ VICTORY ★`   |
| `tamer`     | Beast Tamer  | Praderas de flores                                           | Tamer · Leafling · Emberpup · Voltbit · Aquafin · Starling; Professor               | un bicho glitch salvaje | `◓ CAUGHT!`     |

Quest es el modo quest original de Jucer Orozco; los otros tres son sus juegos de
koombea/cineco-orchestrator PR #32. Los nombres están traducidos al español; el final es pixel art, en
inglés o en español. Las palabras y los colores del HUD por juego del PR #32, la
barra ATB de Crystal Saga, la evolución de Beast Tamer, el encuentro salvaje mientras se espera y la
animación de la casilla entregada de cada juego no se portaron: necesitan lógica más allá de lo que
pueden describir los datos de una escena.

Cada uno también viste al advisor de Jev ([El elenco](#el-elenco-una-mascota-y-el-advisor-de-jev)): Quest con un
mago, Night Watch con el comisionado, Crystal Saga con un oráculo y Beast Tamer con el profesor. Ninguno
tiene mascota, así que Pet le da corazones a Clawd, el héroe, como antes.

Cada uno incluye el roster integrado de Orca para la escena (`ORCHESTRATOR_GAME_BUILT_IN_ROSTERS`, 12
nombres; una prueba del mod fija que ambos sean iguales) y viste cada nombre después del primero como
un [personaje](#personajes-un-look-por-nombre-del-roster) propio.

## Render: classic, hd o hd-compact

`render` elige cómo se dibuja la escena del spinner
([`orchestrator-game-render.ts`](../../../src/shared/orchestrator-game-render.ts) lo valida a él y a
`timezone`; el mod refleja ambos en
[`game-render.ts`](../../../resources/claude-plugins/orca-game/hooks/game-render.ts)). Se resuelve por
clave como el resto, llega al pane como `ORCA_GAME_RENDER` y `ORCA_GAME_TIMEZONE` al lanzarse y
a través de `game state` después, y `/orca-game:render classic|hd|hd-compact` lo sobrescribe para la
sesión de este pane del mismo modo que `/orca-game:mode on|zen|off` sobrescribe el modo; cualquiera de
los dos por sí solo imprime ambos. El host nunca se entera de una sobrescritura, así que `game state`
sigue informando el valor configurado, y ambos comandos dicen cuál es cuál:
`Render: hd (this session; the project's setting is classic, from default).`
`orca game state` imprime
`Render: hd (from project), timezone America/Bogota (from global)`, y un render desconocido o una zona
que el runtime no conoce se descarta con un aviso (Settings rechaza esa zona al introducirla).

- **classic** (predeterminado): el pixel art de 5 filas de arriba.
- **hd** ([`scene-hd.ts`](../../../resources/claude-plugins/orca-game/hooks/scene-hd.ts)): 9 filas, 10
  cuando la terminal tiene 48 filas de alto, a resolución nativa. Un degradado de cielo con el sol o la
  luna y su resplandor, dos capas de nubes que se desplazan, un paisaje lejano difuminado hacia el
  cielo, una capa intermedia de colinas, árboles cercanos, cactus, cristales, antenas o flores a escala
  de los personajes, un estanque que refleja el cielo y una línea de suelo con textura. Cada personaje
  (el héroe, el grupo, la mascota y el advisor de Jev) recibe un contorno de 1 px entintado con el color
  más oscuro de su propia paleta, un lado iluminado y otro sombreado y una sombra en el suelo, así que
  las figuras de un archivo de escena conservan sus colores
  ([`hd-sprite.ts`](../../../resources/claude-plugins/orca-game/hooks/hd-sprite.ts)). El contorno es
  siempre una línea de tinta oscura: por debajo de la mitad de la luminancia del color más oscuro de la
  figura y por debajo de 0.03 de luminancia relativa, así que una paleta cuyo color más oscuro es
  brillante (una capa cian) nunca se lee como un resplandor. Las capas lejana e intermedia mantienen al
  menos 8 de luminosidad CIE respecto a la fila de cielo que tienen detrás, hacia un mismo lado para
  toda la capa: más oscuras que un cielo brillante, más claras que un cielo nocturno demasiado oscuro
  para quedar por debajo ([`hd-layer-contrast.ts`](../../../resources/claude-plugins/orca-game/hooks/hd-layer-contrast.ts)).

Sobre eso, hd agrega:

- **Día y noche** según el reloj en `timezone`, muestreado al inicio, en
  cada refresco y aproximadamente cada 30 segundos: oscuro de 19:00 a 05:00, claro de 07:00 a 17:00, un
  tinte naranja alrededor de las 06:00 y las 18:00, estrellas y la luna de noche, nubes atenuadas con el
  cielo. El sol cruza la mitad derecha del cielo, saliendo a media banda al amanecer y poniéndose en el
  borde derecho al atardecer, en lo más alto al mediodía (la mitad izquierda es donde están las nubes de
  pensamiento del héroe y del grupo), y la luna hace lo mismo de 18:00 a 06:00, así que el amanecer y el
  atardecer se distinguen por dónde está el disco. Un look creado como nocturno (todas las fases de
  Night Watch salvo el handoff) es su propia medianoche; de día se aclara hacia un cielo nublado con un
  sol y un paisaje más claro, y un look diurno oscuro (una alerta roja, un atardecer) se aclara lo justo
  para que el mediodía siga leyéndose como día. Los colores del vestuario nunca cambian con la hora en
  un look nocturno ([`hd-daylight.ts`](../../../resources/claude-plugins/orca-game/hooks/hd-daylight.ts)).
  `local` significa la zona del escritorio: Orca le pasa al pane su propia zona IANA al lanzarse y
  en `game state` (`sources` sigue diciendo de dónde vino `local`), así que un pane en un host SSH, cuyo
  reloj suele estar en UTC, pasa a noche cuando anochece para la persona.
- **Partículas**: polvo de día, luciérnagas de noche, nieve en Night Watch, destellos en Crystal Saga y
  brasas sobre la fogata junto a la que descansa el héroe. Nada mezcla un píxel con sus vecinos (sin
  bloom, viñeta, resplandor del sol, rayos de luz ni neblina en el paisaje lejano), así que cada borde
  queda tan nítido como en koombea-quest: ambos dibujan medios bloques `▀` en truecolor, y esas pasadas
  eran la diferencia.
- **Movimiento**: una caminata de cuatro fotogramas con balanceo del cuerpo, respiración en reposo, y el
  grupo siguiendo al héroe (o sentado junto al fuego). Al caminar, la mascota va justo detrás del héroe y
  el grupo detrás de la mascota, siempre a la izquierda del héroe ya que ninguna figura se refleja, y el
  camino del héroe empieza donde caben todos; un escenario estrecho junta al grupo (hasta 8 columnas de
  separación, luego sin el accesorio del héroe) y dibuja solo a los compañeros que caben enteros
  ([`hd-party.ts`](../../../resources/claude-plugins/orca-game/hooks/hd-party.ts)). El contorno de cada miembro se tiñe con el color de su estado (oscurecido hasta la misma
  tinta, para que nunca resplandezca) con un `!` pulsante sobre el que
  te está esperando. Un miembro que se une entra caminando desde el borde derecho; uno que se va sale
  caminando; el primer refresco no hace marchar a nadie.
- **El líder**: cuando este pane es el líder del proyecto (`role: lead` en `game state`) el héroe lleva
  una corona y su etiqueta (`orchestrator.label`, o si no `Lead`) bajo los pies.
- **Reacciones del equipo**, a partir de lo que cada refresco ya lee: una recompensa hace flotar
  `+N XP` con un destello dorado, un compañero que empieza a esperar hace flotar `<name> needs you!` en
  rojo, una revisión con merge hace flotar `#N merged!` con un destello blanco, y el CI que pasa a rojo
  destella en rojo, sacude la escena una columna durante unos ticks y hace llover desde una nube gris. El
  primer refresco de una sesión no reproduce nada (un CI en rojo desde hace horas no es noticia),
  `/orca-game:demo` dibuja su grupo pero sin textos flotantes ni marchas, y un texto flotante más ancho
  que la escena se omite, mientras que uno que taparía una nube sube a su lado
  ([`team-events.ts`](../../../resources/claude-plugins/orca-game/hooks/team-events.ts)).
- **La nube de pensamiento** lleva lo que dice el héroe: bultos a lo largo de su parte superior, un
  brillo y una sombra, un contorno de 1 px y una estela de dos burbujas que se mece hacia la cabeza del
  héroe. La mascota mimada habla desde ella, y el advisor de Jev dice sus palabras en una nube propia en
  el borde derecho, que la nube del héroe, los corazones y los textos flotantes nunca tapan.

Cada texto dibujado pasa por un único filtro de glifos
([`rasterGlyphsOf`](../../../resources/claude-plugins/orca-game/hooks/game-strings.ts)): las marcas
invisibles se descartan, y cualquier cosa más ancha que una celda o fuera de los rangos latino, de
puntuación, de cajas y de bloques que dibuja un Raster se convierte en `?`, así que un emoji en un
texto nunca puede hacer que la terminal rechace el fotograma. El arte usa solo el medio bloque superior
y glifos de texto que traen SF Mono, Menlo, Consolas y DejaVu Sans Mono.

- **hd-compact**: la escena hd, las figuras y los efectos en una banda fija de 7 filas (`HD_COMPACT_ROWS`)
  que no crece con el pane, para quien quiere hd sin su altura. Por debajo de 8 filas no hay espacio
  sobre la cabeza del héroe, así que su nube de pensamiento flota a su lado (`heroCloudLeftOf` en
  [`hd-words.ts`](../../../resources/claude-plugins/orca-game/hooks/hd-words.ts)). Un Orca o mod más
  antiguo que no conoce el valor lo descarta con el aviso habitual y dibuja classic.

La banda sobre el prompt tiene como máximo 8 filas, así que su escena de mascota (el advisor actuando
mientras el líder está inactivo, Pet sin spinner) se queda en classic con cualquiera de los dos render.

**Costo.** A 120 columnas, mediana de 9 rondas de 800 fotogramas con las celdas empaquetadas: classic
0.126 ms caminando y 0.103 ms en reposo (0.136 y 0.114 antes de que llegara hd), hd 0.570 y 0.585 ms.
El cielo (degradado, sol o luna, resplandor) se guarda en caché por tamaño, look y luz diurna cuantizada; las
siluetas lejana e intermedia por tamaño y paso de desplazamiento; los sprites con contorno por vestuario
y fotograma. Los búferes de píxeles y de celdas se reutilizan por tamaño, y un tick que dibuja el
fotograma que un Raster ya muestra no envía nada
([`frame-gate.ts`](../../../resources/claude-plugins/orca-game/hooks/frame-gate.ts)).

`pnpm run capture:orca-game-scenes -- [--out <dir>] [--scene-file <json>] [--phases <all|a,b>]`
([`orca-game-scene-captures.mjs`](../../../config/scripts/orca-game-scene-captures.mjs)) renderiza cada
escena integrada, y un archivo de escena, en classic y hd a las 06:00, 12:00, 18:00 y 23:00, a 130 y 60
columnas, a PNG a través de Playwright, con una hoja etiquetada por escena y fase. Un archivo de escena se
dibuja en cada fase y las integradas en `build`, salvo que `--phases` nombre otras. Dibujan las celdas que
el mod le pasa a su Raster en un navegador: no son capturas de pantalla de una terminal, ya que la fuente
y la gamma de una terminal difieren.

## El archivo de escena propio de un proyecto

Un proyecto puede dibujar su propia escena sin escribir un plugin: `orchestratorGame.sceneFile` es una
ruta a un JSON de escena **relativa a la raíz del worktree**
([`orchestrator-game-scene-file.ts`](../../../src/shared/orchestrator-game-scene-file.ts)).

```yaml
# orca.yaml
orchestratorGame:
  sceneFile: .orca/scenes/mario.json
```

- **De dónde se lee.** Solo de las capas del proyecto: `orca.yaml` y Settings → el proyecto →
  **Agent Teams game**. Los Settings globales nunca lo ofrecen, y un valor global escrito a mano se
  ignora con un aviso, ya que una ruta solo tiene sentido dentro de un proyecto.
- **Precedencia.** Un `sceneFile` gana sobre un `scene` en la misma capa o en una inferior; un `scene`
  en una capa superior gana sobre él (una escena en los Settings del proyecto supera a un archivo de
  `orca.yaml`). Elegir una escena en el selector del proyecto borra el `sceneFile` de esa capa y
  viceversa, así que el selector es la única fuente de verdad para la capa.
- **Validación.** Una ruta absoluta, una ruta con unidad de Windows o UNC, o una ruta con una parte
  `..` se descarta con un aviso, en el resolvedor compartido para cada capa. Las barras invertidas se
  convierten en `/`, y las partes `.` y vacías se descartan, así que `./.orca//scenes/a.json` se guarda
  como `.orca/scenes/a.json`.
- **Lectura.** `game.state` lee el archivo en cada construcción, así que una edición aparece en el
  siguiente sondeo del mod sin reiniciar ([`worktree-game-scene-file.ts`](../../../src/main/worktree-game-scene-file.ts)).
  El archivo de un worktree SSH se lee desde su host a través del proveedor de sistema de archivos SSH,
  como su `orca.yaml`; cada worktree lee su propia copia. Un enlace que se resuelve fuera del worktree,
  un archivo de más de 64 KB o un host SSH desconectado cuentan como ilegibles.
- **Qué recibe el juego.** Un archivo válido se valida con el mismo parser que una escena de plugin y
  se envía en `extensions.scenes` como `{ id: "file:<path>", pluginId: "file", definition }`, y
  `config.scene` es ese id `file:<path>`, así que el mod lo dibuja como una escena aportada. Un archivo
  ausente o inválido pone `config.scene` en `quest` y coloca `Scene file <path>: <reason>; drawing Quest`
  primero en `warnings`, que el mod muestra como su nota. Un mod anterior a esto descarta la escena
  `file:` y dibuja `quest`.
- **Formato.** El mismo JSON que una escena de plugin ([Escenas del juego](./plugin-development.md#escenas-del-juego)):
  cada fase en `looks`, `costumes` y `cards`, más `teller` y `band`, y opcionalmente un
  [`cast`](#el-elenco-una-mascota-y-el-advisor-de-jev) con su propia mascota y su advisor. Los colores son cadenas
  `#rrggbb` o enteros; el validador propio del mod
  ([`scene-shape.ts`](../../../resources/claude-plugins/orca-game/hooks/scenes/scene-shape.ts)) acepta
  ambos, igual que el de Orca.
- **Colores de la banda del equipo.** El objeto opcional `hud` pinta el marco de pixel art y el cielo de
  la banda del equipo: `skyTop`, `skyBottom`, `frame`, `text`, `dim` (la segunda línea de cada
  compañero) y `star`, los seis obligatorios cuando `hud` está presente. Sin él la banda conserva el
  cielo nocturno de Quest, así que solo los personajes y los chips (`band`) toman los colores de la
  escena.
- **Bloque 3D.** El objeto opcional `scene3d` es lo que dibuja el panel WebGL de Orca (ORCA-683),
  parseado aparte en [`orchestrator-game-scene-3d.ts`](../../../src/shared/orchestrator-game-scene-3d.ts):
  `figure` (`sphere`, `torus`, `helix`, `wave` o `clusters`) y `nodes` (de 50 a 1600, el tope que
  mantiene el archivo de cualquier proyecto dentro del presupuesto de memoria) son obligatorios; `links`
  por nodo (de 0 a 4, por defecto 3), `spin` (de 0 a 1, por defecto 0.3), `pulses` (por defecto `true`) y
  `colors.node`, `.link`, `.glow` (por defecto: los looks propios de la escena) son opcionales.
  `orca game scene validate` informa un bloque incorrecto como `scene3d.<key>: <message>` y sale con 1,
  pero el juego solo descarta el bloque con un aviso y dibuja la escena en 2D. Una build de Orca o un mod
  anterior al bloque ignora la clave.

**Settings.** El selector **Scene** del proyecto termina con **Custom file…**, que muestra la ruta
(escrita, relativa a la raíz del proyecto; una ruta que sale del proyecto se rechaza en línea) y tres
acciones:

- **Choose file…** abre un diálogo nativo para archivos `.json` que empieza en el proyecto, y rechaza un
  archivo fuera de él. Está oculto en proyectos SSH, donde el diálogo solo podría explorar este equipo.
- **Create from <scene>** escribe la escena integrada actual (Quest cuando la escena efectiva no es
  integrada) como JSON con formato y colores `#rrggbb` en `.orca/scenes/<scene id>.json`, o `-2`, `-3`…
  cuando ese ya existe (nunca sobrescribe un archivo), a través del sistema de archivos del proyecto
  (SSH incluido), y luego lo selecciona.
- **Open in editor** abre el archivo en el editor de Orca, en el worktree activo del proyecto o, si no,
  en el principal.

La vista previa bajo el selector pinta el archivo con el código de dibujo del mod y lo vuelve a leer
cuando la ventana recupera el foco; un archivo ilegible o inválido muestra el motivo del parser y la
vista previa dibuja Quest, como lo haría el pane. Un `sceneFile` heredado de `orca.yaml` muestra el mismo
motivo bajo la fila.

## El elenco: una mascota y el advisor de Jev

El `cast` opcional de una escena agrega dos personajes junto a su héroe
([`cast-shape.ts`](../../../resources/claude-plugins/orca-game/hooks/scenes/cast-shape.ts),
[`orchestrator-game-scene-cast.ts`](../../../src/shared/orchestrator-game-scene-cast.ts)). Es el
mismo bloque en el archivo de escena de un proyecto, en la escena de un plugin y en una integrada.

```jsonc
"cast": {
  "pet": {                                   // optional: what Pet hearts
    "name": { "en": "Wolf", "es": "Lobo" },  // optional; names the button
    "frames": [                              // 1 to 4 walking frames
      ["W...W", "WWWWW", "WEWEW", ".WWW.", ".W.W."],
      ["W...W", "WWWWW", "WEWEW", ".WWW.", "W...W"]
    ],
    "happy": ["W...W", "WWWWW", "WHWHW", ".WWW.", ".W.W."],  // while it is petted
    "colors": { "W": "#d8d8d8", "E": "#1a1a1a", "H": "#ff5a8a" }
  },
  "advisor": {                               // optional: who stands for Jev; the referee otherwise
    "name": "Golem",
    "frames": [[".GGG.", "GEGEG", "GGGGG", "G.G.G", ".G.G."]],  // 1 to 4 idle frames
    "gestures": {                            // optional: its body while one gesture plays
      "escalated": [".GGG.", "GRGRG", "GGGGG", "GGG.G", ".G.G."]
    },
    "colors": { "G": "#b8b8b0", "E": "#d83a2e", "R": "#ff3b3b" }
  }
}
```

- **Sprites.** Un fotograma es de 1 a 7 filas de un mismo ancho de 1 a 10 glifos ASCII imprimibles,
  apoyado en el suelo; `.` es transparente y cualquier otro glifo necesita un color (`#rrggbb` o un
  entero). Los fotogramas se dibujan tal como están escritos, nunca reflejados: la mascota mira a la
  derecha como el héroe al que sigue, el advisor a la izquierda, hacia el líder.
  Todos los fotogramas de un integrante, incluidos `happy` y el cuerpo de cada gesto, tienen el tamaño
  del primero. Los nombres siguen las reglas de las tarjetas (una cadena o una por idioma, de 32
  caracteres como máximo).
- **Se deja fuera al integrante incorrecto, no a la escena.** Orca descarta solo el `pet` o el
  `advisor` inválido y dice por qué en `warnings` (`Scene file <path>: cast.pet.frames: …; drawn without it`,
  o `game scene <id>: …; drawn without it` para una escena de plugin), así que una errata nunca se lleva
  la escena y su héroe. `orca game scene validate` lista esos problemas como cualquier otro. Una clave
  de gesto que el juego no conoce se ignora, así que una escena escrita para un juego más nuevo sigue
  cargando.
- **La mascota** camina detrás del héroe (classic: por su camino unos pasos atrás; hd: justo detrás de
  él, delante del grupo) y se sienta a su lado cuando el héroe descansa. El
  botón dice `♥ Pet <name>` (en español `♥ Mimar a <name>`), o `♥ Pet` (`♥ Mimar`) cuando la mascota o
  la escena no tienen nombre, en la banda y en el Panel (`p`). Pet muestra su fotograma `happy`, la
  hace saltar y le espolvorea los corazones; el héroe se queda en el suelo. Una escena sin mascota le
  da los corazones al héroe, Clawd, como antes.
- **El advisor** está en el borde derecho de la escena, y el héroe y su mascota solo recorren el
  escenario a su izquierda. Solo está ahí mientras el `AdvisorState` de Jev (`version: 1`) se puede leer
  en ese pane y el juego dibuja las líneas de otros plugins (`absorbing`: modo distinto de `off`, HUD
  activado), o mientras se reproduce una de las llamadas al advisor de Claude (abajo); si no, no hay
  advisor ni hueco. Representa lo que cambió, nunca cada fotograma: una nueva decisión, un estado de CI
  o un aviso de bloqueo reproduce su gesto y su burbuja durante unos cinco segundos (una tarjeta roja,
  unos ocho), y luego queda en reposo. Mientras el líder está inactivo y ningún spinner dibuja la escena,
  un gesto hace aparecer la escena sobre la banda mientras dura (en zen, no para uno rutinario), como lo
  hace Pet.
  El primer valor que ve es el punto de partida y no reproduce nada, y un valor ya representado nunca
  vuelve a reproducirse, aunque una lectura posterior lo traiga de vuelta. Cuando
  llegan varios cambios a la vez se reproduce el más importante: escalación, una detención o un fallo de
  CI, éxito de CI, bajado o subido, dudoso o la respuesta de una llamada al advisor, CI en ejecución o la
  apertura de una llamada al advisor, y luego aprobado; un gesto más débil nunca corta a uno que todavía
  se está reproduciendo.
- **La compuerta de Jev** responde a cada comando Bash desde un hook `PreToolUse` de settings
  (`gate-bash.ts` de orca-supervisor), por debajo del `classic.PreToolUse` del juego, así que el juego
  lee su veredicto de `next(e)`. El valor `advisor` no lleva veredicto. Puede haberlo juzgado Jev o Clef
  (Clef primero en el modo Both desde orca-supervisor 0.13.0, también los comandos de política desde
  0.13.4); ambos se representan igual, y ninguno toca el valor del advisor. Una denegación cuyo motivo es
  el de la propia compuerta (`REFUSED: …` o `Jev advice (not a refusal)` / `Clef advice …`) reproduce
  `stopped`; un `allow` reproduce `approved` como decisión rutinaria. El motor descarta el motivo de un
  allow, así que el `allow` de otro hook en Bash también lo reproduce. La denegación de otro hook, un
  `ask` y un comando obviamente seguro que la compuerta deja pasar sin veredicto no reproducen nada.
- **Las llamadas al advisor de Claude** vienen de la propia sesión, no de Jev: el juego engancha
  `session.append` y lee las filas de la conversación principal. Claude Code guarda una llamada al
  advisor como una fila de assistant que contiene un bloque `server_tool_use` llamado `advisor`, y
  luego, cuando vuelve el consejo (de 80 s a varios minutos después), una fila de assistant que contiene
  un bloque `advisor_tool_result` cuyo `tool_use_id` coincide. El advisor reproduce `consulting` desde la
  primera fila hasta la segunda, y luego `advised`; un turno que termina con la llamada todavía abierta
  (abortada, fallida) la descarta sin reacción. Otra herramienta de servidor, la llamada de un subagente
  y una sesión que nunca llama al advisor no reproducen nada, y no se repite nada del transcript al
  cargar. Es el mismo hueco de advisor que el de Jev, así que los dos nunca están lado a lado: con Jev
  dibujado, la llamada se reproduce en el advisor de Jev y las señales más fuertes de Jev siguen
  cortándola; sin Jev, o mientras el HUD está apagado y Jev dibuja su propia banda, el advisor entra para
  la llamada y se va después de su reacción.

| Jev                                                         | Gesto                   | El advisor sostiene                          | Burbuja                      |
| ----------------------------------------------------------- | ----------------------- | -------------------------------------------- | ---------------------------- |
| subagente `why: lowered`                                    | `lowered`               | una flecha hacia abajo                       | su modelo · veredicto de Jev |
| subagente `why: raised`                                     | `raised`                | una flecha hacia arriba                      | su modelo · veredicto de Jev |
| `chosen`, `same`, `explicit`, `inherited`                   | `approved`              | un pulgar arriba y un toque de silbato       | su modelo · veredicto de Jev |
| `kept-unsure`, `measuring`                                  | `unsure`                | una tarjeta amarilla y una lupa              | su modelo · veredicto de Jev |
| un nuevo aviso `block`                                      | `escalated`             | una tarjeta roja y un silbato largo          | el aviso                     |
| un run de CI `watching`                                     | `ciRunning`             | un cronómetro                                | la línea del run             |
| un run de CI `success` / `failure`                          | `ciPassed` / `ciFailed` | una bandera verde / roja                     | la línea del run             |
| cambia el modelo o el esfuerzo de la conversación principal | `approved`              | un pulgar arriba                             | `model·effort`               |
| la llamada al advisor de Claude, mientras está abierta      | `consulting`            | una nube de pensamiento llenándose de puntos | `let me think...`            |
| el resultado de la llamada al advisor                       | `advised`               | una bombilla encendida                       | `here is my advice`          |
| la compuerta deniega un comando Bash                        | `stopped`               | una señal de stop, empujando                 | `jev ·` / `clef ·` comando   |
| la compuerta permite un comando Bash que juzgó              | `approved`              | un pulgar arriba                             | el comando                   |

Otros valores de `why` (`kept-pointer`, `teammate`, `no-jev`…) no reproducen nada pero igual llegan al
Panel. La burbuja conserva solo caracteres de ancho 1, así que una flecha o un texto CJK en las palabras
de Jev se omite. En `/orca-game:mode zen` las decisiones rutinarias `chosen` y `same` y los allows de la
compuerta reproducen su gesto sin burbuja. Una denegación `REFUSED` no nombra a ningún juez, así que su
burbuja es solo el comando.

- **La tarjeta del Panel** nombra al advisor y la línea de Jev, repartidas en tantas filas como
  necesiten, luego una fila `★` para la conversación principal de este pane con el modelo con que corre
  ahora (`★ lead · Opus
5.5·high` en el pane del líder, `★ main conversation · …` en los demás), y luego las últimas
  decisiones de subagentes de Jev con su veredicto, coloreadas según el gesto; antes de la primera,
  lista los agentes que están corriendo ahora. Un cambio del modelo principal es la misma conversación,
  así que nunca agrega una segunda fila `★`: cuando el router de Jev baja un turno a Haiku y vuelve, la
  fila simplemente sigue el valor.
  Las decisiones viven en el `$.state` propio del juego `{ plugin: 'orca-game', key: 'advisor' }`
  (`{ decisions: [...] }`), escrito cuando Jev escribe su valor. La tarjeta propia del líder dibuja el
  Jev de este pane del mismo modo que la tarjeta de un miembro dibuja el de un miembro
  (`◆ Jev Opus 5.5·high · model pinned`).
- **El Jev de cada miembro, en el Panel del líder.** El estado de un pane no cruza a otros panes, así que
  el mod del pane de un miembro informa de su propio Jev en el sondeo de `orca game state` que ya ejecuta
  cada 30 s (y de inmediato cuando Jev cambia el modelo o el esfuerzo principal): `ORCA_GAME_ADVISOR` en
  el entorno de la CLI, JSON `{ version: 1, model, effort, pinned: { model, effort } }`, con `pinned`
  leído de `ORCA_AGENT_MODEL_PINNED`/`ORCA_AGENT_EFFORT_PINNED`, o `null` una vez que Jev se detiene
  después de un informe. Un pane donde Jev nunca publicó no envía nada. La CLI lo pasa a `game.state`
  como un parámetro opcional `advisor`, el host lo guarda por pane en memoria (un reinicio lo vuelve a
  llenar en un sondeo, un informe no renovado durante 3 minutos expira) y lo pone en la fila de ese
  miembro dentro del estado de su líder como un `advisor` opcional
  (`{ model, effort, pinned, previous? }`, siendo `previous` lo que Jev tenía antes de su último cambio)
  ([`orchestrator-game-member-advisors.ts`](../../../src/main/runtime/orchestrator-game-member-advisors.ts)).
  La tarjeta del miembro dibuja `◆ Jev Sonnet 5.5·high · model pinned` (el nombre de Jev, luego el pin,
  que se omite en una tarjeta estrecha; lo que aun así no cabe pasa a la línea siguiente, así que el
  modelo nunca se corta) y, después de un cambio, `↳ Opus 5.5 → Sonnet 5.5`, nombrando solo lo que
  cambió; el encabezado de Fleet lo resume (`◆ 2 on Sonnet 5.5, 1 on Opus 5.5`). Una variable de entorno,
  no un flag, porque una CLI más antigua la ignora donde un flag desconocido podría hacer fallar el
  sondeo y una CLI `.cmd` de Windows rechaza `"` en sus argumentos; un host más antiguo elimina el
  parámetro y un mod más antiguo ignora el campo, así que cualquier mezcla de versiones simplemente no
  muestra fila de Jev. Un miembro solo recibe el mod donde corre en Agent Teams (hoy, en local), así que
  un miembro SSH no informa nada.
- **El modelo con el que se lanzó un miembro.** Un miembro que despachó un coordinador no ejecuta ningún
  mod del juego, así que nunca informa de un Jev. Su fila lleva entonces un `launch` opcional
  (`{ model, effort }`), leído del recibo de lanzamiento `effective` del dispatch más nuevo que eligió un
  modelo o un esfuerzo para su terminal (`worker_dispatches.start_options`), con el id de la CLI leído
  como lo leería una persona (`claude-opus-5-5` → `Opus 5.5`). La tarjeta del miembro lo dibuja como
  `◇ Opus 5.5·high`, hueco porque lo eligió Orca, no Jev; un informe de Jev gana sobre él. La tarjeta de
  advisor del líder lista a cada miembro bajo su fila `★ lead` (`◇ ORCA-609 · Opus 5.5·high`, o `◆` para
  un informe de Jev), y el encabezado de Fleet cuenta cualquiera de los dos. Las filas de la tarjeta sin
  gesto usan el color de primer plano propio de la terminal, no el pergamino de la escena, que el panel
  casi blanco de un tema claro ocultaría.

## Personajes: un look por nombre del roster

Un miembro es una sola figura: el mismo sprite en la banda, en el Panel y en el final, en cada fase, así
que la fase se ve por su etiqueta, su objeto y el fondo y no por un cambio de vestuario. Una entrada del
`roster` de una escena es un nombre simple, cuyo look se deriva del nombre, o un objeto que define el look
de ese nombre
([`orchestrator-game-scene-characters.ts`](../../../src/shared/orchestrator-game-scene-characters.ts),
[`character-look.ts`](../../../resources/claude-plugins/orca-game/hooks/character-look.ts)):

```json
"roster": [
  "Arthur",
  { "name": "Merlin", "variant": { "colors": { "O": "#6f8fe0" }, "accessory": "halo", "accessoryColor": "#fff3a0" } },
  { "name": "Elaine", "costumes": { "working": { "rows": [], "legs": [], "colors": {} } } }
]
```

- **Un nombre simple** toma uno de los vestuarios de fase de la escena como cuerpo, un tono para sus
  colores principales y casi siempre un accesorio (nunca la corona del líder), derivados del nombre y del
  roster ([`character-derived-look.ts`](../../../resources/claude-plugins/orca-game/hooks/character-derived-look.ts)).
  No se guarda nada, así que una escena con un roster simple no necesita cambios y cada pane en cada host
  que dibuja la misma escena dibuja la misma figura. Un nombre fuera del roster, uno numerado (`Merlin 2`)
  o un ticket sin nombre recibe un look igual. Solo un pane sin nombre lleva el vestuario de la fase.
- **`variant`.** `colors` (glifo → color) se superpone a un solo cuerpo, el primer vestuario desde el lugar
  del nombre que dibuje esos glifos; un glifo que ningún vestuario dibuja se rechaza. `accessory` es uno de `crown`, `halo`, `horns`,
  `antenna`, `bow`, `feather`, `cape`, dibujado solo en celdas vacías alrededor de la cabeza, en
  `accessoryColor` o en su color predeterminado. Una variante necesita `colors` o un `accessory`;
  `accessoryColor` necesita un accesorio.
- **`costumes`.** Un vestuario para cada fase, validado como los de la propia escena. Es el único look
  que puede cambiar por fase, porque el autor dibujó al mismo personaje en cada una.
- **Validación.** Una entrada con ambos looks, o cualquier look incorrecto, descarta el roster completo
  con un aviso `roster.N…` (nombres incluidos) y la escena se sigue dibujando; `orca game scene validate`
  lista cada problema.
- **Quién es quién.** El mod encuentra el personaje de un miembro por el nombre que hay antes del `·` de
  su nombre visible, en cualquier idioma, sin distinguir mayúsculas y sin un sufijo ` 2`. El héroe se dibuja
  igual: el pane de un miembro por el nombre de su worktree, el de un líder por su título. La banda, las
  casillas del Panel y el grupo hd dibujan la figura; la vista plana pone un `■` en su color antes del nombre.
- **En el wire.** `roster` sigue siendo solo nombres, así que `game.memberName.reserve` y un mod más
  antiguo ven lo mismo de siempre. Los looks viajan en el campo opcional `characters` de la definición
  (`[{ name, variant?, costumes? }]`), que un mod más antiguo ignora. Un Orca anterior a esto descarta con
  un aviso un roster de archivo con entradas de tipo objeto y conserva la escena.
- **Cómo crearlos.** `orca game scene new` empieza con diez personajes. **Create from** de Settings
  escribe los personajes de una escena de vuelta como entradas del roster. La
  [skill de escenas](../../../skill-guides/orca-game-scenes.md#characters-for-an-existing-scene) los agrega
  o los regenera en un archivo existente en su lugar, y las capturas de escenas dibujan cada nombre del
  roster como su casilla del Panel (`sheet-roster-scene-file-<phase>.png`).

## Escenas de plugins

Un plugin de Orca puede agregar más escenas como JSON (`contributes.gameScenes`); `game.state`
envía las válidas en un `extensions.scenes` opcional, cada una como `{ id, pluginId, definition }`
con el `id` en el espacio de nombres `<publisher>.<id>/<scene id>`, y lista las descartadas en
`warnings`. Settings → **Scene** ofrece las escenas integradas más las de los plugins en ejecución, y
sigue mostrando un id de `orca.yaml` que nada instalado sirve; el mod dibuja `quest` para él. Los nombres
de las tarjetas y del narrador pueden ser por idioma (`{ "en": …, "es": … }`); el mod muestra el de
`ORCA_GAME_LOCALE`. El formato del archivo, los límites y las reglas de consentimiento están en
[Escenas del juego](./plugin-development.md#escenas-del-juego).

## Archivos de juegos del arcade

Un juego que el arcade ofrece después de un merge perfecto son datos para uno de los motores integrados
del juego, nunca código. El único motor es `runner` (una tecla para saltar), y el runner integrado es
`src/shared/orchestrator-game-arcade-runner.json`. `orca game game validate <file> [--json]`
comprueba un archivo con las reglas de `src/shared/orchestrator-game-arcade-file.ts`, lista cada problema
como `path: message` y sale con 1 mientras quede alguno.

| Clave        | Qué define                                                                                 |
| ------------ | ------------------------------------------------------------------------------------------ |
| `engine`     | `runner`                                                                                   |
| `name`       | De 1 a 32 caracteres, una cadena o `{ "en": …, "es": … }`                                  |
| `fps`        | Tope de fotogramas, un número entero de 5 a 15                                             |
| `speed`      | `{ start, max, rampPerMinute }` en columnas por segundo; `max` al menos `start`            |
| `difficulty` | `{ minGap, maxGap }`, columnas de suelo entre obstáculos (de 8 a 120)                      |
| `jump`       | `{ rows, ms }`: altura de 2 a 8 filas, tiempo en el aire a `speed.start`, de 200 a 2000 ms |
| `obstacles`  | De 1 a 8, cada uno `{ "from": "scene" }` o un sprite `{ rows, colors }`, con `weight`      |
| `theme`      | Opcional. Colores del look (`skyTop`, `ground`, …) dibujados sobre los de la escena activa |

- `{ "from": "scene" }` es la decoración del suelo de la escena activa (`plantKind`), así que una escena
  personalizada cambia el estilo del juego sin trabajo extra. Una escena cuyo `plantKind` es `none` no
  tiene ninguna, así que la lista debe contener al menos un obstáculo de tipo sprite.
- Un sprite es de 1 a 6 filas del mismo ancho, de 1 a 6 glifos ASCII imprimibles cada una; `.` es
  transparente y cualquier otro glifo necesita un color `#rrggbb` (o entero).
- `weight` (de 0.05 a 1, por defecto 1) es la frecuencia con que se elige un obstáculo frente a los demás.
- El archivo ocupa como máximo 16 KB. Las claves desconocidas se ignoran, así que un archivo más nuevo
  sigue cargando.

### El runner

El mod juega su propia copia del runner integrado
([`arcade-runner-data.ts`](../../../resources/claude-plugins/orca-game/hooks/arcade-runner-data.ts)); una
spec la mantiene igual al JSON que valida Orca. Una partida se dibuja como una banda hd de la escena
activa, de 12 filas de alto: su cielo, nubes, cordillera lejana, colinas y suelo detrás, el vestuario
working de la escena como héroe y su propia decoración (`plantKind`) como obstáculos, recortados a como
máximo 4 píxeles por 5 columnas y con contorno como un personaje. Las plantas dispersas y el estanque
de la escena quedan fuera del fondo, ya que cualquier cosa sobre la línea del suelo se lee como algo que
saltar.

- Una tecla, `j`: inicia una partida, salta, reanuda una partida en pausa y vuelve a empezar después de
  un choque. `q` (o Esc) cierra el pane. Una pulsación despega en el acto, no en el siguiente fotograma.
- El salto se ajusta a la velocidad: `jump.ms` es su tiempo en el aire a `speed.start`, y una partida
  más rápida pasa menos tiempo en el aire pero cubre más columnas, así que cada obstáculo deja al menos
  150 ms para acertar la pulsación desde la velocidad inicial hasta la máxima
  (`tests/arcade-runner-fair.spec.ts` recorre cada momento de pulsación). Una segunda pulsación en el
  aire salta una vez más, hasta un cuarto más alto que el pico; una pulsación en los últimos 120 ms antes
  de aterrizar despega de nuevo al tocar el suelo.
- Cada 20 s es un nivel: la velocidad sube `rampPerMinute` durante ese tiempo hasta `speed.max`, el
  nombre del nivel aparece un momento, los huecos se cierran y los obstáculos empiezan a llegar en
  parejas y tríos a un rebote de distancia. Hay monedas a lo largo de algunos saltos y, desde el nivel 2,
  en lo alto de un hueco donde solo llega el salto en el aire; las monedas seguidas forman un combo que
  vale más cada vez. La línea superior muestra el mejor puntaje de la sesión y el nivel a la izquierda, y
  el combo y el puntaje a la derecha. Nada se guarda más allá de la sesión.
- La partida avanza con su propio temporizador a `fps`, nunca por encima de 15, y solo mientras se
  mueve: ninguno antes de la primera pulsación, ninguno una vez que el pane se oculta o pierde el teclado
  (se pausa), ninguno después de un choque.
- A 160 columnas un fotograma cuesta alrededor de 1 ms, así que una partida en juego usa menos del 2% de
  un núcleo.

`/orca-game:demo arcade` (o `/quest demo arcade`) abre una partida de práctica en un pane propio: no
gana puntos ni XP, no escribe nada en Orca ni en el store, no agrega ningún ajuste, y cerrar el pane
descarta la partida.

Un pane de líder (`role` distinto de `member`, recompensas activadas) ofrece una partida cuando la
revisión de un miembro pasa a `perfectMerge: true` entre dos sondeos
([`arcade-unlock.ts`](../../../resources/claude-plugins/orca-game/hooks/arcade-unlock.ts)). La oferta
se identifica por el id de la recompensa del merge perfecto y se guarda bajo `arcade-offers` en
`$.store`, así que un merge visto de nuevo después de una repetición o una recarga nunca se ofrece dos
veces. `/orca-game:demo offer` (o `/quest demo offer`) reproduce la misma oferta
([`arcade-offer.ts`](../../../resources/claude-plugins/orca-game/hooks/arcade-offer.ts)), sin guardar
nada:

- La escena celebra (el texto flotante del merge y las estrellas de subida de nivel, dibujados en la
  banda mientras está inactiva) y el pane del arcade se abre pidiendo el teclado, para que `j` y `n`
  lleguen al pane y nunca al prompt. Claude Code solo lo concede sobre un compositor vacío, sin ningún
  diálogo ni encuesta abiertos, así que el texto que el usuario está escribiendo sigue siendo suyo; en
  ese caso la línea indica `ctrl+x tab, then j`, que ahí es cierto.
- Una línea bajo el marco hace una cuenta atrás de 15 segundos. `j` (o un clic en Play) inicia la
  partida; `n`, Esc o el final de la cuenta atrás cierra el pane y descarta la oferta.
- Mientras un compañero espera al usuario (el "Needs you" de la banda), o la pregunta propia de un
  miembro espera a su líder, la cuenta atrás se detiene, una partida en juego se mantiene sin
  fotogramas, y una oferta abierta en ese momento deja el teclado al prompt para la respuesta; ambas
  continúan solas una vez que se responde.
- Los puntos que gana la partida de una oferta real se mantienen separados de la XP de los miembros;
  una oferta de demo no escribe ninguno.

## Otros plugins en un pane del juego

Otros plugins de Claude Code siguen funcionando en un pane del equipo; mientras el juego se dibuja (modo
`on`, `zen` o `flat` con la banda activada) el mod dibuja lo que muestran con el estilo de la escena en
lugar de dejar que cada uno pinte lo suyo
([`allies-strip.tsx`](../../../resources/claude-plugins/orca-game/hooks/allies-strip.tsx)):

- **Líneas de estado.** Un hook `ui.status` toma el `$.ui.status(text)` de otro plugin antes de que
  Claude Code lo vea y lo guarda como una fila de la **franja de aliados** bajo la banda, etiquetada con
  el nombre del plugin; `undefined` elimina la fila. Con el juego en `off` la llamada pasa sin tocarse.
  El `statusLine` propio del usuario no es una llamada de plugin y nunca se toca.
- **Jev.** La franja lee `$.state` `{ plugin: 'orca-jev-mod-skills', key: 'advisor' }` (el
  `AdvisorState` de Jev, `version: 1`) sin depender de Jev: su línea con model·effort, una fila por cada
  subagente en ejecución (título, modelo, veredicto), sus filas de CI y su último aviso. Cualquier otra
  versión, o un valor que no es un advisor, se ignora, así que un Jev más nuevo no dibuja ninguna fila en
  lugar de una incorrecta. La banda se vuelve a dibujar cuando se escribe ese
  valor; nada lo sondea. El mismo valor pone al advisor de Jev en la escena y su tarjeta
  en el Panel ([El elenco](#el-elenco-una-mascota-y-el-advisor-de-jev)).
- **Seguir al juego.** El juego publica `{ plugin: 'orca-game', key: 'absorbing' }`, un
  `boolean` verdadero exactamente mientras dibuja las líneas de otros plugins (modo distinto de `off`,
  HUD activado), al cargar y en cada cambio: el entorno, la configuración en vivo de Orca y
  `/orca-game:mode`. Jev lo lee, así que un pane donde el juego deja de dibujar (`/orca-game:mode off`,
  el HUD apagado en Settings) vuelve a mostrar la línea propia de Jev, y uno donde empieza nunca muestra
  a Jev dos veces. `/orca-game:mode off` mantiene la banda (el HUD tiene su propio interruptor) y quita
  la franja, ya que los otros plugins pasan entonces a dibujar por sí mismos.
- **Una fila incorrecta.** Un valor de advisor que Jev amplía con una fila que la franja no puede leer
  pierde solo esa fila; el resto de Jev se sigue dibujando. Cualquier otra `version` no dibuja ninguna
  fila de Jev.
- **Líneas obsoletas.** Cada sesión empieza sin ningún estado retenido, así que un plugin que se
  desactivó, se recargó o se cayó sin limpiar su línea no deja nada atrás.
- **Zen** conserva una fila: la línea de Jev o, si no, el último estado.
- **Bandas.** Un plugin cuyo hook `AbovePrompt` está por debajo del juego conserva su contenido,
  dibujado bajo la franja, y un hook `ui.resolve` pinta el `Text` de cada otro plugin con la paleta de la
  escena (un tramo resaltado como la píldora dorada; el rojo, el verde, el amarillo y los colores de
  error, advertencia y éxito del tema se mantienen). Un plugin cargado en el nivel `prepend` dibuja fuera
  del juego y puede ocultarlo.

La franja conserva como máximo seis filas, la última indicando cuántas dejó fuera, y cada fila se recorta
al ancho de la banda (la etiqueta a un tercio de él, luego el texto, y la insignia es lo primero que se
quita).

## Panes estrechos

La banda se distribuye según el ancho del pane
([`chip-rows.ts`](../../../resources/claude-plugins/orca-game/hooks/chip-rows.ts)): los chips de estado
ocupan como máximo dos filas y el menú una, solo con chips enteros. Cuando no caben, las etiquetas menos
importantes se acortan primero (`2 working` a `• 2`, la revisión a `#42 ✗`, Refresh y Pet a su
icono), luego se quitan chips y un `+N` los cuenta. Por debajo de 37 columnas el marco del HUD no tiene
espacio para un compañero, así que se convierte en una línea de texto (`Lv 2 · • builder  ! scribe`); por
encima de eso, los compañeros que el marco no puede acomodar se cuentan como `+N` en su borde superior.
Los anchos se miden en celdas de terminal, así que un texto CJK en una etiqueta (el nombre de un
compañero, una rama o un ticket) cuenta dos por carácter.
