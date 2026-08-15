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
9. **Release** sólo con el checklist de `lab-release-smoke-check.md` pasado.

## Las guardas, y la falla que las originó

| Guarda                          | Qué hace                                                                 | Por qué existe                                                                                                                                                                          |
| ------------------------------- | ------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `session-start-plane-board.py`  | Inyecta el board al abrir sesión                                         | El board quedó describiendo un estado de hace horas mientras el trabajo real iba por otro lado                                                                                          |
| `status-line.py`                | Muestra proyecto · rama · sin-commitear                                  | La status line por defecto no dice ni el directorio ni la rama, así que no había forma de saber dónde se estaba trabajando                                                              |
| `pre-commit-branch-guard.py`    | Antes de commit/push dice rama, upstream y cuánto falta subir            | Se hicieron 5 commits creyendo que iban a `main` cuando iban a una rama de feature, y se reportó "mergeado a main" siendo falso                                                         |
| `main-merge-guard.py`           | Rechaza desde la Bash tool cualquier push o merge que aterrice en `main` | Un worker mergeó el PR #73 a `main` por su cuenta, minutos después de que el mensaje que lo dirigía dijera que el merge lo hacía el coordinador. La única barrera era prosa en un brief |
| `test-result-guard.py`          | Lee el resumen de vitest y bloquea si hay rojos, ignorando el exit code  | **Medido**: `npm test` salió con exit code 0 reportando `Tests 6 failed \| 40082 passed`. Un gate que mire `$?` deja pasar un build roto                                                |
| `pre-release-upstream-check.sh` | Chequea upstream antes de despachar una release                          | El checklist de release exige mergear `origin/main` primero y se salteaba                                                                                                               |

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
