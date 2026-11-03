---
sourceHash: 3fffd0e3b602025d
---
# orca-sonar en Orca

orca-sonar (`ab2webco/orca-sonar`, id de plugin `ab2web.orca-sonar`) les da a los agentes búsqueda rápida de
archivos y símbolos con menos tokens. Orca lo invoca mediante `orca sonar <command>`.

## Integración

- **Instalación única** en Settings → Plugins desde `https://github.com/ab2webco/orca-sonar.git#<ref>`.
  La ref es obligatoria. Los plugins necesitan `pluginSystemEnabled`.
- **Punto de entrada:** `orca sonar <args>` encuentra el árbol instalado a través de
  `<userData>/plugins/ab2web.orca-sonar/current`, un hash de contenido que nombra la carpeta activa, y
  ejecuta `node <tree>/bin/orca-sonar.ts <args>` con el stdio y el código de salida de quien lo llama.
- **Comprobación de habilitación:** antes de ejecutar el árbol, `orca sonar` le pide `plugins.list` al runtime local
  de Orca y se niega a menos que Sonar aparezca en la lista y no esté `disabled`, `pending` (una actualización
  esperando consentimiento), `invalid` ni en la lista de bloqueo. Una entrada ausente significa que el sistema de
  plugins está desactivado. `plugins.list` y esos campos son anteriores a esta comprobación, así que una CLI más nueva
  que la app en ejecución no necesita ningún cambio de protocolo. Un worker que falló (`errored`) no la bloquea: la
  CLI nunca usa el worker.
- **Precalentamiento:** cuando se crea un worktree local, Orca inicia `orca-sonar index --root <worktree>`
  en segundo plano con `ORCA_SONAR_WARMUP=1`. Nunca se espera, se termina a los 30 segundos y sus fallos van al
  log de depuración sin hacer fallar la creación. No hace nada a menos que el plugin esté instalado y Orca le
  conceda sus capacidades: un plugin deshabilitado, una actualización esperando consentimiento, un plugin en la
  lista de bloqueo o el sistema de plugins apagado significan que no hay precalentamiento, porque el
  precalentamiento ejecuta el código del plugin igual que lo haría su worker.
- **Interruptores del dueño:** la página de Settings del plugin tiene dos interruptores, guardados en su propio
  almacenamiento. Con _agents_ desactivado, `find` y `symbol` terminan con código 1 y "Sonar is turned off for
  agents"; con _warm-up_ desactivado, una ejecución de `index` marcada con `ORCA_SONAR_WARMUP=1` termina con
  código 0 sin indexar. La CLI del plugin aplica ambos, así que Orca no necesita una copia de ellos.
- **Descubrimiento por agentes:** la guía `orca-cli` (`orca skills get orca-cli`) tiene una sección de Sonar y,
  desde la 0.2.0, el plugin incluye una skill `orca-sonar`. Una skill vincula el consentimiento al árbol instalado,
  así que cada actualización del plugin vuelve a pedir consentimiento, y el precalentamiento espera hasta que se
  otorga.
- **Requisitos:** Node 24 o posterior en el `PATH`. La CLI ejecuta TypeScript sin paso de compilación.
- **Índice:** `<userData>/plugins-data/ab2web.orca-sonar/index/<repoId>/<rootKey>.sqlite`.
  No se escribe nada en un repositorio, en un worktree ni en `.claude/`.

## Modos de fallo

| Situación                          | Resultado                                                                     |
| ---------------------------------- | ----------------------------------------------------------------------------- |
| Plugin no instalado                | error `sonar_not_installed`, código 1, remite a Settings → Plugins            |
| `current` no es un hash de contenido | error `invalid_pointer`, código 1, reinstala el plugin                      |
| El árbol no tiene `bin/orca-sonar.ts` | error `missing_entry`, código 1, reinstala el plugin                       |
| Orca no está ejecutando el plugin  | error `sonar_plugin_inactive`, código 1, nombra el estado y la solución       |
| Orca Lab no está en ejecución      | error `runtime_unavailable`, código 1, el estado de habilitación es desconocido |
| Host remoto de Orca                | error `sonar_remote_unavailable`, código 1, rechazo explícito, sin salida     |
| Instalado y en ejecución           | la salida y el código de salida propios de la CLI                             |

## Aún no incluido en esta integración

- **Hosts remotos:** el índice debe construirse donde están los archivos, y la CLI debe estar instalada
  ahí. Se rechaza de forma explícita hasta que el dueño decida la distribución remota.
- **Distribución:** la publicación en el marketplace y el valor predeterminado de `pluginSystemEnabled` son
  decisiones del dueño y no se cambian aquí.
- **Panes de Codex:** acceden a la CLI y a la guía, no a una skill del plugin.

## Comprobaciones

- `src/shared/sonar-cli-location.test.ts`, `src/cli/sonar-command.test.ts`: el puntero, las rutas de no instalado
  y de host remoto, cada estado en el que Orca no ejecutaría el plugin, un runtime inalcanzable, el reenvío de
  argumentos y de entorno, y los códigos de salida.
- `src/cli/handlers/sonar.test.ts`: el handler lee `plugins.list` del runtime.
- `src/main/sonar-index-warmup.test.ts`: ningún spawn sin instalación o mientras el plugin no está
  activo, terminación por timeout, ninguna terminación después de la salida, fallos registrados y nunca lanzados.
- `src/cli/bundled-orca-cli-guide.test.ts`: la guía que se sirve a los agentes nombra `orca sonar` y el
  comportamiento alternativo con agents desactivado.
- En vivo: con el plugin instalado bajo un userData temporal, `orca sonar find runCli --json`
  devolvió resultados con código 0, y `git status --porcelain --ignored` en el worktree era el mismo
  antes y después.
