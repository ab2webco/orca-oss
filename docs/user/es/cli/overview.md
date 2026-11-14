---
sourceHash: 6e3adb26df44e16a
---
# CLI

El comando `orca` controla una instancia de Orca Lab en ejecución desde cualquier terminal. Los scripts y los
agentes lo usan para crear worktrees, controlar terminales, coordinar agentes, dirigir un equipo y compartir
artifacts.

## Instalación

Abre **Settings > General > Orca Lab CLI** y elige **Register** en **Shell command**.

- En macOS, Orca Lab enlaza `orca` en `/usr/local/bin`, o en `~/.local/bin` cuando esa carpeta
  existe y `/usr/local/bin` no.
- En Windows, Orca Lab agrega la carpeta del comando a tu PATH de usuario.
- En los builds AppImage de Linux, Orca Lab instala un script envoltorio.
- WSL tiene su propia entrada **WSL shell command**.

Usa **Remove** en el mismo lugar para deshacer el registro.

## Grupos de comandos principales

- `orca open`, `orca status` y `orca serve`: inician Orca Lab, comprueban que está en ejecución o lo ejecutan sin
  ventana en un servidor.
- `orca worktree`: crea, lista, muestra, configura y elimina worktrees, y encuentra o detiene los procesos que
  quedan dentro de uno.
- `orca terminal`: crea, lista, lee, divide, renombra, despierta y cierra terminales, les envía texto y espera en
  ellas.
- `orca orchestration`: envía mensajes, hace preguntas y despacha tareas entre agentes.
- `orca game`: dirige un equipo: un líder, un miembro por ticket, la flota, el historial y el Inbox.
- `orca account`: lista las cuentas y su cuota en caché, agrega una cuenta, cambia de cuenta de Claude y guarda un
  token de Claude de larga duración.
- `orca environment`: guarda, lista y elimina los hosts de Orca Lab emparejados en los que ejecutas miembros.
- `orca artifacts`: comparte, actualiza, lista, elimina y deja de compartir artifacts HTML o Markdown.
- `orca plane` y `orca linear`: leen y actualizan las tareas vinculadas.
- `orca sonar`: busca en el repositorio a través del índice de Orca Sonar.

Ejecuta `orca --help` u `orca <group> --help` para ver la lista completa de subcomandos y opciones. Todos los
comandos aceptan `--json` para una salida legible por máquina.

## Dirigir un equipo: orca game

Ejecútalos desde la terminal del líder, o desde cualquier terminal de Orca del proyecto en el caso de los de solo
lectura. [Agent Teams](../agents/agent-teams.md) explica el líder y sus miembros.

| Comando                                     | Qué hace                                                                                        |
| ------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `orca game lead [--fresh]`                  | Convierte esta sesión en el líder del proyecto. `--fresh` retira la conversación del líder anterior en lugar de reabrirla. |
| `orca game leads`                           | Lista los líderes activos en este host de Orca.                                                 |
| `orca game launch <ticket>`                 | Inicia un miembro para un ticket en su propio worktree. `--on <host> --repo <selector>` lo ejecuta en un host emparejado; `--account`, `--agent`, `--model` y `--effort` sustituyen la elección del proyecto. |
| `orca game wave [<ticket>,...]`             | Lanza miembros para los tickets indicados, o llena los huecos libres desde el To Do. `--dry-run` solo imprime el plan. |
| `orca game fleet`                           | Lista los miembros con su ticket, PR, CI, fase y siguiente paso, incluidos los agentes pausados y los encontrados. |
| `orca game state`                           | El estado del juego de la terminal actual, incluidos `review.ci` y `review.mergeState`.         |
| `orca game member <ticket\|character>`      | Qué hace ahora un miembro y qué hizo desde su lanzamiento.                                       |
| `orca game accounts [--refresh]`            | Cada cuenta administrada con su uso de 5 h y 7 d y los miembros que corren en ella.             |
| `orca game move <ticket>`                   | Mueve a otra cuenta un miembro que llegó al límite de su cuenta.                                 |
| `orca game adopt <name\|ticket>`            | Convierte en miembro un agente que la flota encontró en ejecución (aquí o en un host emparejado), para que el correo fluya en ambos sentidos. |
| `orca game drop <name\|ticket>`             | Saca un agente de la flota sin detenerlo ni tocar su worktree.                                   |
| `orca game sweep [--close]`                 | Lista los miembros terminados y lo que cada uno deja pendiente. `--close` los registra en el historial y libera sus pestañas. |
| `orca game history`                         | Los miembros liberados del proyecto: ticket, resultado, PR, personaje, agente, cuenta y host. Filtra con `--ticket`, `--character` o `--since`. |
| `orca game resume-members`                  | Recupera los miembros que un reinicio dejó en pausa, o los libera con `--discard`.               |
| `orca game owner-questions`                 | Lo que el líder te preguntó y sigue esperando respuesta. Responde con `orca game answer-owner`.  |
| `orca game metrics`                         | Tickets terminados, lead time y miembros liberados por resultado.                                |
| `orca game stop <ticket>\|--all [--hold]`   | Detiene miembros y los registra en el historial. `--all --hold` además pone un STOP que rechaza nuevos lanzamientos hasta `orca game resume`. |
| `orca game adopt-history --from-repo-id <id>` | Incorpora a este proyecto el historial, las lecciones y el STOP que dejó un id de repo eliminado. |
| `orca game scene list`                      | Lista las escenas incluidas y los archivos de escena del proyecto. `scene new` y `scene validate` crean uno. |
| `orca game view <view> --scope project\|global` | Guarda la vista de la banda de la terminal para este proyecto o para todos.                  |

```bash
orca game launch ORCA-101
orca game launch ORCA-102 --on build-box --repo path:/srv/orca-oss
orca game wave --dry-run
orca game history --since 2026-11-01
```

## Terminales y worktrees

- `orca terminal wake --terminal <handle>` despierta una terminal de agente dormida y retoma su conversación en la
  misma cuenta, como cuando haces clic en ella en la ventana. Agrega `--environment <host>` para una terminal en
  un host emparejado.
- `orca terminal state` lee el estado de un agente desde el log de su propia sesión, no desde la pantalla.
- `orca terminal rename` pone o quita el título de una pestaña.
- `orca worktree processes --worktree <selector>` lista los procesos cuyo directorio de trabajo está dentro de un
  worktree; `--stop` termina solo los huérfanos.
- `orca worktree rm` rechaza el worktree de un miembro del equipo que no ha terminado, incluso con `--force`, que
  solo omite la comprobación de cambios sin guardar. `--force-member` lo elimina de todos modos.

```bash
orca terminal wake --terminal term_abc123
orca worktree processes --worktree active --stop
orca worktree rm --worktree id:wt-1 --force-member
```

## Cuentas

- `orca account list` muestra cada cuenta administrada de Claude y Codex con su cuota en caché. Nunca imprime
  credenciales.
- `orca account add` agrega una cuenta en este host.
- `orca account switch --to <email|id>` cambia una terminal a otra cuenta de Claude y retoma la misma
  conversación.
- `orca account token set --account <email|id>` guarda un token de larga duración de `claude setup-token` para una
  cuenta de Claude en este host, y `orca account token clear` lo elimina. Consulta
  [Seguimiento de uso y cuentas](../agents/usage-tracking.md#tokens-de-larga-duración).

```bash
orca account list
orca account token set --account me@example.com
```

## Orca Sonar

Con el plugin Orca Sonar activado, `orca sonar find <words...>` encuentra las líneas que contienen todas las
palabras y `orca sonar symbol <name>` encuentra las declaraciones con ese nombre exacto, desde un índice en lugar
de una búsqueda completa. `orca sonar status` muestra qué contiene el índice. Consulta
[Orca Sonar](../../../reference/orca-sonar.md).

## Cómo se conecta

La CLI lee un archivo de runtime en la carpeta de datos de Orca Lab y se comunica con la app en ejecución por un
socket local. Necesita que Orca Lab esté en ejecución, excepto para `orca open`.
