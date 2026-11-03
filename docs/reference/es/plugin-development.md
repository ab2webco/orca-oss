---
sourceHash: 7a3042336372ea13
---
# Escribir un plugin de Orca

Todo lo que sigue está verificado contra el código fuente de este repositorio; cada afirmación cita
`file:line`. Toda la superficie de plugins es **experimental**: no hay promesas de
compatibilidad hasta que `pluginApi` v1 se congele
([`plugin-manifest.ts:51`](../../../src/shared/plugins/plugin-manifest.ts),
[`plugin-host-api.ts:16`](../../../src/shared/plugins/plugin-host-api.ts)).

Un plugin es una carpeta con un `orca-plugin.json` en su raíz
([`plugin-manifest.ts:190`](../../../src/shared/plugins/plugin-manifest.ts)). Puede
contener dos tipos de código, y se ejecutan en entornos muy distintos:

|                | **Panel** | **Worker** |
| -------------- | --------- | ---------- |
| Entorno de ejecución | iframe en sandbox, origen opaco, solo `sandbox="allow-scripts"` ([`PluginPanel.tsx:273-276`](../../../src/renderer/src/components/right-sidebar/PluginPanel.tsx)) | `child_process.fork` del binario de Electron como Node puro ([`plugin-host-process.ts:78-93`](../../../src/main/plugins/plugin-host-process.ts)) |
| Alcance de la API del host | 5 de los 13 métodos, más `panel.close` y `panel.runCommand` a nivel del bridge ([`plugin-host-api.ts:273-275`](../../../src/shared/plugins/plugin-host-api.ts)) | los 13 |
| Red            | CSP `default-src 'none'; connect-src 'none'` ([`plugin-panel-shell.ts:25-27`](../../../src/shared/plugins/plugin-panel-shell.ts)) | solo los hosts declarados en `net:fetch` ([`plugin-host-preload.ts:66-78`](../../../src/main/plugins/plugin-host-preload.ts)) |
| Sistema de archivos | ninguno | solo lectura, su propia carpeta ([`plugin-worker-sandbox-args.ts:11-19`](../../../src/main/plugins/plugin-worker-sandbox-args.ts)) |
| Vida útil      | mientras su superficie está montada | perezosa: se hace fork con el primer comando (paleta o `panel.runCommand`) o evento suscrito, y se recoge tras 5 min inactivo ([`plugin-host-protocol.ts:110-112`](../../../src/shared/plugins/plugin-host-protocol.ts)) |

Este repo incluye dos ejemplos completos:
[`examples/plugins/hello-orca`](../../../examples/plugins/hello-orca) (mínimo) y
[`examples/plugins/worklog`](../../../examples/plugins/worklog) (una plantilla que
ejercita todo lo de esta página). Copia el segundo.

## Ponerlo en marcha

El sistema de plugins viene desactivado: `pluginSystemEnabled`
([`global-settings-types.ts:328`](../../../src/shared/global-settings-types.ts),
`false` por defecto en [`constants.ts:329`](../../../src/shared/constants.ts)). Actívalo
en **Settings → Plugins** y luego instala por carpeta o por URL de Git
([`plugin-install-source.ts:11-39`](../../../src/renderer/src/components/settings/plugin-install-source.ts)
interpreta `https://…#ref`; el `#ref` es obligatorio).

Mientras desarrollas, agrega la carpeta a **Development** en su lugar. Esa lista es
`devPluginPaths` ([`global-settings-types.ts:338`](../../../src/shared/global-settings-types.ts),
leída en [`index.ts:2945`](../../../src/main/index.ts)); el plugin se carga directamente
desde el directorio, y una ruta de desarrollo **prevalece sobre** un plugin instalado con la misma
identidad ([`plugin-discovery.ts:238-251`](../../../src/main/plugins/plugin-discovery.ts)).
Editar el HTML de un panel recarga el frame sin reinstalar.

## El manifiesto

`orca-plugin.json` lo interpreta `pluginManifestSchema`
([`plugin-manifest.ts:107-177`](../../../src/shared/plugins/plugin-manifest.ts)).
`contributes` es `.strict()` (línea 160): una clave no declarada hace fallar todo el
manifiesto, y por eso también un plugin no puede "agregar después" un campo.

### Identidad y restricciones

| Campo | Regla |
| ----- | ----- |
| `manifestVersion` | literal `1` ([`:109`](../../../src/shared/plugins/plugin-manifest.ts)) |
| `pluginApi` | literal `1`: la versión mayor de la API del host a la que apuntas ([`:125`](../../../src/shared/plugins/plugin-manifest.ts)) |
| `id`, `publisher` | kebab-case `[a-z0-9]+(-[a-z0-9]+)*`, ≤ 64 caracteres, ni `__proto__`/`prototype`/`constructor` ([`plugin-manifest-fields.ts:4-20`](../../../src/shared/plugins/plugin-manifest-fields.ts)) |
| identidad | `<publisher>.<id>`: también es el nombre del directorio de instalación ([`plugin-manifest.ts:193-195`](../../../src/shared/plugins/plugin-manifest.ts)) |
| `version` | semver ([`:56`, `:114`](../../../src/shared/plugins/plugin-manifest.ts)) |
| `engines.orca` | solo la forma `>=x.y.z` ([`:62-65`](../../../src/shared/plugins/plugin-manifest.ts)); por debajo de ella el host se niega a cargar el plugin durante el descubrimiento ([`plugin-discovery.ts:110-117`](../../../src/main/plugins/plugin-discovery.ts)) |
| `main` | ruta relativa a la entrada del worker; opcional ([`:127`](../../../src/shared/plugins/plugin-manifest.ts)) |
| `description`, `author`, `repository`, `icon` | opcionales ([`:116-121`](../../../src/shared/plugins/plugin-manifest.ts)) |

Toda ruta de un manifiesto es una _ruta relativa portable dentro de la carpeta del plugin_
([`plugin-manifest-fields.ts:24-28`](../../../src/shared/plugins/plugin-manifest-fields.ts)),
y, aparte, la contención por realpath rechaza escapes por symlink cuando se lee el
archivo. Escribe `icons/logo.svg`, nunca `./icons\logo.svg` ni una ruta absoluta:
ambos separadores se aceptan al importar ([`plugin-host-runtime.ts:82`](../../../src/main/plugins/plugin-host-runtime.ts)),
pero el manifiesto se compara como texto.

**Identidades reservadas.** Un `publisher` igual a `ab2web`, _o cualquier `id` que empiece por
`orca-`_, está reservado ([`plugin-marketplace.ts:157-164`](../../../src/shared/plugins/plugin-marketplace.ts)).
Un plugin así no se puede instalar en absoluto desde una ruta local y tiene que resolverse a
la organización `ab2webco` por Git
([`plugin-install-trust.ts:11-30`](../../../src/main/plugins/plugin-install-trust.ts)).
Elige otra cosa.

### Qué acepta `contributes`

| Clave | Límite | Notas |
| ----- | ------ | ----- |
| `panels`        | 64 ([`:57`](../../../src/shared/plugins/plugin-manifest.ts)) | `id`, `title`, `entry`, `icon` y `surface` opcionales |
| `commands`      | 256 ([`:58`](../../../src/shared/plugins/plugin-manifest.ts)) | `id`, `title`, `context` (`global`\|`worktree`) y `action` opcionales |
| `events`        | 4: todo el conjunto cerrado ([`:93-99`](../../../src/shared/plugins/plugin-manifest.ts)) | `worktree.created`, `worktree.removed`, `agent.status.changed`, `notification.dispatched` |
| `settings`      | 32 ([`plugin-settings-contribution.ts:15`](../../../src/shared/plugins/plugin-settings-contribution.ts)) | formulario declarativo, renderizado por Orca |
| `automations`   | 16 ([`plugin-automation-contribution.ts:32`](../../../src/shared/plugins/plugin-automation-contribution.ts)) | trabajo programado |
| `keybindings`   | 256 ([`plugin-content-pack-contributions.ts:11`](../../../src/shared/plugins/plugin-content-pack-contributions.ts)) | debe nombrar un comando aportado y coincidir con su contexto ([`plugin-manifest-contribution-validation.ts:102-120`](../../../src/shared/plugins/plugin-manifest-contribution-validation.ts)) |
| `languagePacks` | 16 ([`:10`](../../../src/shared/plugins/plugin-content-pack-contributions.ts)) | uno por locale |
| `vmRecipes`     | 64 ([`:12`](../../../src/shared/plugins/plugin-content-pack-contributions.ts)) | |
| `agents`        | 64 ([`:13`](../../../src/shared/plugins/plugin-content-pack-contributions.ts)) | perfiles de agente |
| `skills`        | 32 ([`:16`](../../../src/shared/plugins/plugin-content-pack-contributions.ts)) | un directorio con un `SKILL.md`, que se sirve a **cualquier** agente en **cualquier** workspace |
| `gameScenes`    | 8 ([`:17`](../../../src/shared/plugins/plugin-content-pack-contributions.ts)) | `id`, `path` a una escena JSON para el juego de Agent Teams; consulta [Escenas del juego](#escenas-del-juego) |
| `capabilities`  | 32 ([`plugin-manifest.ts:174`](../../../src/shared/plugins/plugin-manifest.ts)) | ver más abajo |

Reglas entre campos que rechazan un manifiesto de plano
([`plugin-manifest-contribution-validation.ts:122-182`](../../../src/shared/plugins/plugin-manifest-contribution-validation.ts),
[`plugin-settings-contribution.ts:116-142`](../../../src/shared/plugins/plugin-settings-contribution.ts)):

- `main` es obligatorio cuando algún comando no tiene `action` integrada, cuando
  `contributes.events` no está vacío o cuando se declara `process:spawn`.
- `contributes.events` requiere la capability `events:subscribe`; suscribirse
  a `notification.dispatched` además requiere `notifications:observe`.
- `contributes.skills` requiere `skills:contribute`.
- `contributes.settings` requiere `settings:own`; un setting `secret` además
  requiere `secrets`.
- Se rechazan ids duplicados de panel/comando/automatización/gameScene, locales duplicados,
  rutas duplicadas de vmRecipe/agente/skill y keybindings duplicados.

Los archivos declarados también tienen tope de tamaño al instalar y al descubrir
([`plugin-artifact-validation.ts:16-25`](../../../src/main/plugins/plugin-artifact-validation.ts)):
entrada del panel 10 MB, entrada del worker 50 MB, ícono del plugin 2 MB, language pack 5 MB,
VM recipe 256 KB, perfil de agente 1 MB, `SKILL.md` 256 KB, escena del juego 64 KB.

## Capabilities y consentimiento

Existen once tipos de capability, y solo esos
([`plugin-capabilities.ts:14-26`](../../../src/shared/plugins/plugin-capabilities.ts)).
Un error tipográfico hace fallar la validación del manifiesto en lugar de no conceder nada en silencio.

| Tipo | Desbloquea | Se le muestra al usuario como ([`:91-119`](../../../src/shared/plugins/plugin-capabilities.ts)) |
| ---- | ---------- | ------------------------------------------------------------------------------------------- |
| `workspace:read`        | `workspace.readContext` | "Read the name, branch, and terminal list of your focused worktree" |
| `terminal:send`         | `terminal.sendText` | "Type text into a terminal you can see (always a specific terminal)" |
| `notifications:show`    | `notifications.show` | "Show desktop notifications labeled with the plugin name" |
| `notifications:observe` | el evento `notification.dispatched` (con `events:subscribe`) | "Receive a copy of the notifications Orca Lab raises, even ones this computer does not show, including their text, which can quote agent replies, tool input and terminal titles" |
| `storage`               | `storage.get/set/delete/keys` | "Store data in the plugin's own storage folder" |
| `secrets`               | `secrets.get/set/delete` | "Store and read secrets in the plugin's own encrypted vault" |
| `settings:own`          | `settings.get/set` | "Read and change the plugin's own settings" |
| `events:subscribe`      | `events.subscribe` y `contributes.events` | "Get notified when worktrees are created or removed and when agent status changes" |
| `net:fetch`             | `fetch` en el worker, solo a los hosts declarados | "Connect to these network hosts: …" |
| `process:spawn`         | `--allow-child-process` en el worker | "Start programs as you. Programs it starts are not constrained by this plugin worker's file or network permissions." |
| `skills:contribute`     | `contributes.skills` | "Teach every agent, in every project, how to use this plugin…" |

`net:fetch` es el único tipo con alcance: recibe `hosts`, de 1 a 64 entradas, cada una un
hostname o un comodín `*.example.com`
([`plugin-capabilities.ts:59-80`](../../../src/shared/plugins/plugin-capabilities.ts)).

El control es de denegación por defecto y se aplica en cada frontera que un plugin puede invocar
([`plugin-capability-gate.ts:34-63`](../../../src/shared/plugins/plugin-capability-gate.ts)).
Un plugin desactivado, uno desconocido y uno con consentimiento obsoleto fallan
de forma idéntica (`consent_required`), para que el código del plugin no pueda sondear la diferencia.

### La huella de consentimiento, y por qué las actualizaciones vuelven a preguntar

El consentimiento se registra como `<publisher>.<id> → fingerprint`
([`plugin-consent-state.ts:12-27`](../../../src/shared/plugins/plugin-consent-state.ts)).
El plugin está `approved` solo mientras la huella registrada sea igual a la actual;
si no, está `pending`. `needsReconsent` distingue "nunca aprobado"
de "aprobado y luego cambiado" ([`:31-38`](../../../src/shared/plugins/plugin-consent-state.ts)).

La huella es un SHA-256 sobre tres partes
([`plugin-consent-fingerprint.ts:37-58`](../../../src/shared/plugins/plugin-consent-fingerprint.ts)):

1. el conjunto de capabilities canonicalizado, insensible al orden y a los duplicados, de modo que
   reformatear el manifiesto no invalida el consentimiento
   ([`plugin-capabilities.ts:127-148`](../../../src/shared/plugins/plugin-capabilities.ts));
2. si `main` existe o no: agregar un worker a un plugin que solo tiene panel cruza
   una frontera de confianza incluso con la lista de capabilities sin cambios;
3. **el hash de contenido del árbol instalado**, pero solo cuando el manifiesto trae
   contribuciones _instructivas_: `keybindings`, `vmRecipes`, `agents`,
   `automations` o `skills`
   ([`plugin-consent-fingerprint.ts:14-30`](../../../src/shared/plugins/plugin-consent-fingerprint.ts)).

La parte 3 es la que sorprende. Esos bytes se ejecutan después bajo
la autoridad del usuario (o de un agente), así que la aprobación queda atada al árbol exacto.
**Cualquier** actualización de un plugin así, incluida la corrección de una errata en el README, produce un
nuevo hash de contenido, una nueva huella y una nueva solicitud de consentimiento; la superficie del panel
pasa a `pending-update` hasta que el usuario aprueba
([`plugin-panels.ts:30-37`](../../../src/renderer/src/store/plugin-panels.ts)). Un
plugin sin ninguna de esas cinco contribuciones conserva su consentimiento en una actualización
que no cambia capabilities ni agrega `main`. `languagePacks` y
[`gameScenes`](#escenas-del-juego) no están entre ellas a propósito: ambos son datos inertes
que Orca renderiza, nunca se ejecutan y nunca se entregan a un agente.

Para un plugin en ruta de desarrollo, la identidad es un hash vivo de la carpeta
([`plugin-discovery.ts:135-143`](../../../src/main/plugins/plugin-discovery.ts)), así que
editar cualquier archivo de un plugin que declara una automatización, incluidos `.git` y las cachés,
lo devuelve a `pending`.

Para evitarlo mientras desarrollas, marca **Trust changes in this folder** bajo la
carpeta en **Settings → Plugins → Development**. La lista es
`trustedDevPluginPaths` ([`global-settings-types.ts:341`](../../../src/shared/global-settings-types.ts)),
vacía por defecto. Para una carpeta de confianza, la parte 3 es una identidad fija en lugar del
hash del árbol ([`plugin-consent-fingerprint.ts:16`](../../../src/shared/plugins/plugin-consent-fingerprint.ts)):
las ediciones de contenido conservan la aprobación y las lecturas instructivas sirven los bytes actuales,
mientras que un cambio de capability o un `main` nuevo vuelve a preguntar. Marcar la casilla
vuelve a preguntar una vez, porque la huella pasa del árbol a la identidad
de confianza. Las carpetas sin confianza y los plugins instalados conservan el hash del árbol.

## Paneles

Un panel aporta `{ id, title, entry, icon?, surface? }`
([`plugin-manifest.ts:67-81`](../../../src/shared/plugins/plugin-manifest.ts)).
`surface` elige dónde aparece:

- `worktree` (por defecto): la barra lateral derecha de cada worktree.
- `settings`: su propia página en la tarjeta del plugin en Settings. El frame crece hasta
  la altura que informa el panel, así que la página de Settings hace scroll como una sola página; no
  pongas un contenedor con scroll dentro del panel. Su ancho es lo que le queda a la columna de Settings
  después de la barra lateral fija de ajustes de la app: unos 830px en una ventana maximizada,
  ~415px en una ventana de 768px, y **menos de 100px** por debajo de unos 700px, donde
  la propia página de Settings deja de ser usable. Dale al panel `min-width: 0`,
  `overflow-wrap: anywhere` y un diseño alternativo de una sola columna, o desbordará una
  caja que nunca eligió.
- `nav`: un destino de primer nivel en la barra lateral izquierda, para contenido global.
  Orca dibuja un encabezado sobre el frame con el título del panel y un botón de cierre
  (también Escape), que vuelve a la vista que el usuario dejó; el propio panel puede
  cerrarlo con `panel.close`.

`icon` es un nombre de un conjunto curado de 32 íconos de lucide
([`plugin-panel-icon.tsx:42-75`](../../../src/renderer/src/components/right-sidebar/plugin-panel-icon.tsx);
`file-text` y `FileText` resuelven ambos) o un `.svg` relativo en tu carpeta que
el host sanea. Cualquier cosa no reconocida recurre al ícono de enchufe
([`:101-112`](../../../src/renderer/src/components/right-sidebar/plugin-panel-icon.tsx)).

### Lo que el host pone alrededor de tu HTML

Tu documento se _anexa a_ un shell generado por el host, así que el `<head>` del shell
se interpreta primero ([`plugin-panel-shell.ts:88-200`](../../../src/shared/plugins/plugin-panel-shell.ts)).
Recibes, sin pedirlo:

- **Una CSP que no puedes aflojar**: `default-src 'none'; connect-src 'none';
script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:;
font-src data:; base-uri 'none'; form-action 'none'`
  ([`:25-27`](../../../src/shared/plugins/plugin-panel-shell.ts)). Sin red, sin
  scripts externos, sin imágenes externas. Una segunda meta CSP tuya solo puede
  endurecerla.
- **La tipografía de la app.** Geist va embebida como un `@font-face` woff2 en `data:`, y
  `body` recibe `font-family: var(--font-sans)`, `font-size: 14px`,
  `line-height: 1.5`, `letter-spacing: 0.01em`
  ([`:75-86`](../../../src/shared/plugins/plugin-panel-shell.ts)). Declarar tu
  propio `font-family` te saca de ella.
- **Una escala de radios** derivada de `--radius`: desde `--radius-sm` (0.6×) hasta
  `--radius-4xl` (2.6×), más `box-sizing: border-box` en todo
  ([`:78-82`](../../../src/shared/plugins/plugin-panel-shell.ts)).
- **Una clase de tema en `<html>`**: literalmente `light` o `dark`, que el
  renderer rellena a partir del documento vivo ([`:101`](../../../src/shared/plugins/plugin-panel-shell.ts),
  [`plugin-panel-design-token-css.ts:21-23`](../../../src/renderer/src/components/right-sidebar/plugin-panel-design-token-css.ts)).
  Cambiar el tema de la app reconstruye el frame con nuevos valores de token
  ([`PluginPanel.tsx:83-86`](../../../src/renderer/src/components/right-sidebar/PluginPanel.tsx)),
  así que normalmente nunca necesitas la clase: los tokens ya cambiaron.
- **Una respuesta a las comprobaciones de liveness y un aviso de la altura del contenido**, ambos dentro del shell
  porque el host no puede leer dentro de un frame de origen opaco
  ([`:99-197`](../../../src/shared/plugins/plugin-panel-shell.ts)).

**No** recibes Tailwind, `main.css`, ningún asset empaquetado ni el DOM de la app. El
shell deja `input`, `button` y `select` sin estilos a propósito, para que los paneles
existentes conserven el aspecto con el que se publicaron: igualar la app es tarea de tu CSS, y
tu CSS siempre gana porque se interpreta después en el mismo documento.

### Los design tokens que de verdad recibes

Exactamente estos 22, capturados del documento vivo e inyectados como custom
properties en `:root`
([`plugin-panel-shell.ts:39-62`](../../../src/shared/plugins/plugin-panel-shell.ts);
inyección en [`plugin-panel-design-token-css.ts:9-19`](../../../src/renderer/src/components/right-sidebar/plugin-panel-design-token-css.ts)):

```
--background      --foreground
--card            --card-foreground
--popover         --popover-foreground
--primary         --primary-foreground
--secondary       --secondary-foreground
--muted           --muted-foreground
--accent          --accent-foreground
--destructive     --destructive-foreground
--border          --input            --ring
--radius          --font-sans        --font-mono
```

Es un subconjunto curado de `main.css`, no todo: congelar cada token como
API pública bloquearía refactors futuros. La lista crece de forma aditiva; renombrar o
quitar una entrada es un cambio incompatible para los plugins instalados.

Todo lo visual debe salir de estos tokens o calcularse a partir de ellos
(`calc(var(--radius) * …)`, `color-mix(…)`). Un color literal estará mal en
uno de los dos temas. A los valores se les quitan `{}<>;` antes de inyectarlos, así que
nada de lo que contenga un token puede escaparse del bloque `<style>`.

### Hablar con el host: el bridge de postMessage

El panel envía mensajes a `window.parent` con `targetOrigin: '*'`: el origen del frame
es opaco, así que cualquier cosa más estricta se descarta en silencio; el host identifica la
_ventana que envía_ en lugar de confiar en un origen
([`plugin-panel-bridge-host.ts:79-93`](../../../src/renderer/src/components/right-sidebar/plugin-panel-bridge-host.ts)).

Solicitud: `{ type: 'orca-panel-action', requestId, action, params }`.
Respuesta: `{ type: 'orca-panel-action-result', requestId, ok, value?, errorCode?, error? }`
([`plugin-panel-bridge.ts:15-19, 68-108`](../../../src/shared/plugins/plugin-panel-bridge.ts)).
`requestId` es tuyo, de 1 a 128 caracteres.

Siete acciones se pueden invocar desde el panel: cinco métodos de la API del host, derivados de la tabla
de la API del host para que nunca se desvíen del gate
([`plugin-host-api.ts:273-275`](../../../src/shared/plugins/plugin-host-api.ts)),
más dos acciones a nivel del bridge
([`plugin-panel-bridge.ts:58-76`](../../../src/shared/plugins/plugin-panel-bridge.ts)):

| Acción | Capability | Notas |
| ------ | ---------- | ----- |
| `workspace.readContext` | `workspace:read`     | el worktree enfocado, o `null` |
| `terminal.sendText`     | `terminal:send`      | `terminalId` explícito, nunca "la terminal activa" |
| `notifications.show`    | `notifications:show` | |
| `storage.get`           | `storage`            | espacio de nombres privado del plugin |
| `storage.set`           | `storage`            | espacio de nombres privado del plugin |
| `panel.close`           | ninguna              | pide al host que cierre la página en la que está este panel; los params deben estar ausentes o ser `{}`; responde `{ closed: true }` |
| `panel.runCommand`      | ninguna              | ejecuta uno de los comandos del worker de tu plugin; params `{ commandId }`; responde `{ ran: true }` cuando termina |

`panel.close` no es un método de la API del host, así que los workers no pueden llamarlo (no tienen
página) y no necesita capability: cerrar su propia página no le da al panel
nada que el usuario no pueda hacer con un clic, y un nuevo tipo de capability haría fallar
la validación del manifiesto en todas las versiones antiguas de Orca. Aun así pasa por todas las comprobaciones del bridge
que pasan las otras cinco: la comprobación de la ventana que envía y el presupuesto de mensajes en el renderer, y luego
el enlace a la sesión, el presupuesto de admisión y las comprobaciones de aprobación en main
([`plugin-panel-controller.ts:79-121`](../../../src/main/plugins/plugin-panel-controller.ts)).
Solo se cierran las páginas `nav`; en las superficies `worktree` y `settings`, donde el propio
chrome de Orca ya cierra la barra lateral o sale de Settings, responde
`ok: false, errorCode: 'unavailable'`
([`plugin-panel-bridge-host.ts:161-190`](../../../src/renderer/src/components/right-sidebar/plugin-panel-bridge-host.ts)).
Un servidor remoto más antiguo responde `unknown_method`.

Toda página `nav` recibe además un botón de cierre del host y Escape, haga lo que haga el plugin.
Las teclas pulsadas dentro del frame nunca llegan a la ventana de Orca, así que mientras el foco
está en tu panel, Escape es tuyo: si tu panel debe cerrarse con Escape, escúchalo
y llama a `panel.close`, después de que tus propios diálogos e inputs hayan tenido su
turno.

`panel.runCommand` es la forma en que un botón de tu panel hace trabajo en tu worker.
Ejecuta el comando exactamente como lo haría la paleta, así que un worker detenido arranca
primero, y responde cuando el handler retorna, o con
`ok: false, errorCode: 'action_failed'` y el mensaje de error del handler. El
comando debe ser tuyo y lo debe manejar tu worker: el comando de otro plugin,
un comando del host o un alias de acción integrada en tu propio manifiesto
responden `invalid_params` y no ejecutan nada
([`plugin-panel-controller.ts:124-155`](../../../src/main/plugins/plugin-panel-controller.ts)).
No necesita capability: el usuario ya aprobó tu plugin con ese comando
dentro, y el panel solo podría pedir lo que la paleta ya ofrece. Solo
los paneles propios de la app de escritorio pueden usarlo; un panel alojado a través de una
conexión remota recibe `unavailable`, porque ejecutar comandos sigue siendo una decisión
del escritorio allí. Un Orca más antiguo responde `invalid_request` (la acción no se puede
invocar desde el panel), así que detecta la función por la respuesta, no por la versión. El handler
tiene el presupuesto habitual de 30 segundos por comando; para trabajo más largo, inícialo y retorna,
y luego informa el progreso a través de storage.

En particular, **no** se pueden invocar desde el panel: `storage.delete`, `storage.keys`, todo
`secrets.*`, todo `settings.*`, `events.subscribe`. Un panel que necesita un
setting declarado tiene que hacer que el worker lo replique en una clave de storage; eso es
lo que hace `examples/plugins/worklog`, con un botón **Publish now** que ejecuta
el comando de replicación mediante `panel.runCommand`.

`errorCode` es uno de `invalid_request`, `unknown_method`, `capability_denied`,
`consent_required`, `panel_forbidden`, `invalid_params`, `rate_limited`,
`unavailable`, `action_failed`
([`plugin-panel-bridge.ts:83-92`](../../../src/shared/plugins/plugin-panel-bridge.ts)).

### El presupuesto de mensajes, y el bug que provoca

Por plugin, el bridge admite **30 mensajes por ventana deslizante de 10 000 ms**, y
limita un mensaje individual a **64 KiB**
([`plugin-panel-bridge.ts:23-24`](../../../src/shared/plugins/plugin-panel-bridge.ts);
control en [`plugin-panel-message-budget.ts:19-45`](../../../src/shared/plugins/plugin-panel-message-budget.ts)).
El tráfico sobredimensionado o malformado también gasta presupuesto. Por encima del límite, el host
responde `ok: false, errorCode: 'rate_limited'`
([`plugin-panel-bridge-host.ts:118-143`](../../../src/renderer/src/components/right-sidebar/plugin-panel-bridge-host.ts)).

Dos cosas consumen esos 30 antes que tú:

- El watchdog hace ping cada 10 s y tu pong también se carga al presupuesto de datos
  ([`:110`](../../../src/renderer/src/components/right-sidebar/plugin-panel-bridge-host.ts),
  intervalo en [`plugin-panel-bridge.ts:36`](../../../src/shared/plugins/plugin-panel-bridge.ts)).
  Un pong tiene su propio carril reservado de 1 KiB para que un presupuesto de datos saturado nunca
  haga parecer muerto a un panel vivo ([`:31`](../../../src/shared/plugins/plugin-panel-bridge.ts)),
  pero el _conteo_ sigue saliendo de los 30.
- Los informes de altura del contenido, aunque el shell solo envía uno cuando la altura
  cambió de verdad ([`plugin-panel-shell.ts:166-171`](../../../src/shared/plugins/plugin-panel-shell.ts)).

Así que la falla concreta: un panel que consulta, por ejemplo, seis claves de storage cada dos
segundos quema su ventana en diez segundos y se queda saturado. El usuario hace clic en un
botón, el `storage.set` del clic vuelve como `rate_limited`, y si el panel
lee `result.value` sin comprobar `result.ok`, ese rechazo es
indistinguible de una respuesta vacía. El clic desaparece sin error y el
panel pinta datos obsoletos encima de la escritura que nunca ocurrió.

No hagas polling. Llama ante acciones explícitas del usuario, y comprueba siempre `ok` antes de
tocar `value`.

### Nunca retornes sin decir por qué

Este es el error que todos cometen, y lo que lo hace difícil de detectar es que
el código parece defensivo. Comprobar `ok` y retornar es solo la mitad; la
otra mitad es que el clic del usuario ya se perdió y nada en pantalla lo dice:

```js
// WRONG. Two silent returns: on a refusal the write never happens, the panel
// stays on "Saving…", and the user has no idea their click was dropped.
call('storage.get', { key: 'entries' }).then(function (read) {
  if (!read.ok) return
  call('storage.set', { key: 'entries', value: next }).then(function (write) {
    if (!write.ok) return
    setStatus('Saved.')
  })
})
```

```js
// RIGHT. Every refusal reaches the screen, a rate limit is retried past the
// 10s window because the work started as a click, and a reply that never
// arrives becomes a deadline instead of a frozen panel.
request('storage.get', { key: 'entries' })
  .then(function (read) {
    if (!read.ok) return fail(read) // fail() paints read.reason
    return request('storage.set', { key: 'entries', value: next }).then(function (write) {
      if (!write.ok) return fail(write)
      input.value = '' // only after a confirmed write
      setStatus('Saved.')
    })
  })
  .catch(reportUnexpected) // a throw while rendering, too
```

Tres reglas detrás de esa forma, todas ellas en
[`examples/plugins/worklog/panel.html`](../../../examples/plugins/worklog/panel.html):

1. **Un solo embudo para los rechazos.** Todo `ok: false` pasa por un único `fail()`
   que escribe el motivo en la línea de estado. Un `return` suelto junto a un
   `if (!ok)` es el bug.
2. **`rate_limited` es un freno, no una falla.** Vale la pena reintentar el trabajo que empezó como
   acción del usuario; cualquier espera menor que la ventana de 10 s solo gasta
   otro mensaje y vuelve a ser rechazada, así que espera más allá de ella y di que estás
   reintentando.
3. **Ponle un plazo a cada llamada.** El host responde cada solicitud que recibe,
   pero una respuesta dirigida a un documento o sesión que ya reemplazó se
   descarta, y una promesa que nunca se resuelve es un panel congelado en su última
   línea de estado sin error en ninguna parte. Esa falla es invisible en el code review
   e invisible en tiempo de ejecución; solo un timeout la hace visible.

No borres el input del usuario, ni pintes un estado de éxito, antes de que la escritura vuelva
con `ok`. Ambas cosas le dicen que pasó algo que no pasó.

### Entrega los controles deshabilitados hasta que el script los haya conectado

El documento del panel no es de larga vida. El host lo vuelve a interpretar desde cero cada
vez que reconstruye el frame, y lo reconstruye siempre que cambia la captura del tema incrustada
([`use-plugin-panel-theme-revision.ts:9-32`](../../../src/renderer/src/components/right-sidebar/use-plugin-panel-theme-revision.ts))
o se vuelve a leer el HTML de entrada ([`PluginPanel.tsx:174-213`](../../../src/renderer/src/components/right-sidebar/PluginPanel.tsx)).

Entre que el parser crea un `<button>` y que el `<script>` final adjunta
su listener hay una ventana real. Es invisible en una máquina rápida y lo bastante amplia
en una cargada como para que un clic caiga en un control que no hace nada: sin
handler, sin error, sin cambio de estado; el panel simplemente ignora al usuario.

Así que dale a cada control el estado que realmente tiene:

```html
<input id="entry" type="text" disabled /> <button id="add" type="button" disabled>Add entry</button>
```

```js
// last line of wiring, after every addEventListener
;['entry', 'add', 'refresh'].forEach(function (id) {
  document.getElementById(id).disabled = false
})
```

Un control atenuado que se vuelve activo es honesto sobre un panel que todavía
está arrancando. Un control habilitado que descarta el clic en silencio no lo es.

El mismo hecho tiene una segunda consecuencia: **nada de lo que un panel guarda en su propio
documento sobrevive a una reconstrucción.** La posición del scroll, un formulario a medio escribir, una lista
en caché, una solicitud pendiente: todo se va cuando el frame cambia de clave, y el
panel no recibe aviso ni hook de desmontaje. Todo lo que deba sobrevivir a eso
pertenece a `storage.*`, y por eso esta página lo repite tanto.

### Una superficie, varios flujos

Un panel que escribe su línea de estado y su lista desde más de un lugar tiene que
decidir qué escritura gana. Los flujos no terminan en el orden en que empezaron: un
`load()` que espera dos respuestas del bridge puede llegar _después_ de un clic que empezó más tarde
y ya escribió la verdad más nueva, y entonces vuelve a pintar la más vieja:
estado borrado, la fila que el clic acababa de agregar desaparecida, y ningún error en ninguna parte.

El orden de finalización no es el orden de intención. Dale un dueño a la superficie compartida:

```js
var surfaceOwner = 0
function claimSurface() {
  return ++surfaceOwner
}
function ownsSurface(owner) {
  return owner === surfaceOwner
}
```

Cada flujo la reclama al empezar y comprueba antes de escribir, así que un flujo
reemplazado termina en silencio en lugar de informar un estado obsoleto.
`examples/plugins/worklog/panel.html` lo hace en `load()` y en cada handler.

Dos límites más del panel: una altura de contenido informada se acota a
**48–8000 px**, con **320 px** antes del primer informe
([`plugin-panel-bridge.ts:54-56`](../../../src/shared/plugins/plugin-panel-bridge.ts)),
y un panel que no cumple el plazo del pong de **5 000 ms** pasa a una
insignia de error y queda suspendido ([`:37`](../../../src/shared/plugins/plugin-panel-bridge.ts)).

## Storage, secrets y settings

Tres almacenes separados, todos por plugin, todos bajo
`<userData>/plugins-data/<publisher>.<id>/`
([`plugin-discovery.ts:71-73`](../../../src/main/plugins/plugin-discovery.ts),
[`plugin-storage-store.ts:11-24`](../../../src/main/plugins/plugin-storage-store.ts)),
nunca un blob compartido con espacios de nombres, así que la clave de un plugin nunca puede resolverse en
la de otro.

| Almacén | Archivo | Capability | Topes |
| ------- | ------- | ---------- | ----- |
| `storage.*`  | `storage.json`  | `storage`      | valor ≤ 256 KiB, almacén completo ≤ 5 MiB, ≤ 1024 claves ([`plugin-host-api.ts:68-70`](../../../src/shared/plugins/plugin-host-api.ts)) |
| `settings.*` | `settings.json` | `settings:own` | mismas reglas de claves |
| `secrets.*`  | vault cifrado   | `secrets`      | valor ≤ 64 KiB ([`:83`](../../../src/shared/plugins/plugin-host-api.ts)) |

Las claves tienen de 1 a 256 caracteres y se rechazan `__proto__`/`prototype`/`constructor`
([`:60-65`](../../../src/shared/plugins/plugin-host-api.ts)). Los valores son JSON plano;
una escritura que superaría un tope vuelve como error, no como truncamiento
([`plugin-storage-store.ts:69-93`](../../../src/main/plugins/plugin-storage-store.ts)).
Un archivo de almacén corrupto se lee como vacío en lugar de bloquear el plugin.

### Settings declarativos

`contributes.settings` nombra las claves y Orca renderiza el formulario; los valores van
a los mismos almacenes que ya leen `settings:own` y `secrets`, así que no interviene ninguna
API nueva del host ([`plugin-settings-contribution.ts:3-13`](../../../src/shared/plugins/plugin-settings-contribution.ts)).

Cada entrada es `string`, `boolean` o `number`, con `key` (primero una letra, luego
letras/dígitos/guion bajo, ≤ 64), `label`, y `description`, `default` y
`required` opcionales; `string` agrega `placeholder` y `secret`; `number` agrega `min`/`max`
([`:17-62`](../../../src/shared/plugins/plugin-settings-contribution.ts)). Un
string con `secret: true` se guarda en el vault cifrado en lugar de en
`settings.json`.

Dos reglas que rechazan el manifiesto ([`:82-97`](../../../src/shared/plugins/plugin-settings-contribution.ts)):
un setting `required` no puede declarar un `default` (el estado "necesita configuración", que
es su razón de ser, sería inalcanzable), y un `secret` tampoco puede declararlo.
Un setting obligatorio sin valor pone al plugin en `needsSetup`
([`plugin-list-projection.ts:227-232`](../../../src/main/plugins/plugin-list-projection.ts));
un string vacío cuenta como no configurado, no solo uno ausente
([`plugin-settings-contribution.ts:169-182`](../../../src/shared/plugins/plugin-settings-contribution.ts)).

## El worker

`main` se importa como módulo ES por URL de archivo, y su **export por defecto es la
función activate** ([`plugin-host-runtime.ts:82-90`](../../../src/main/plugins/plugin-host-runtime.ts)).
Un export con nombre `deactivate`, opcional, se espera al apagar. La activación se
espera antes de que el host marque el worker como listo, y el plazo para estar listo es de
**10 s** ([`plugin-host-protocol.ts:108`](../../../src/shared/plugins/plugin-host-protocol.ts)):
mantenla corta.

```js
export default async function activate(orca) {
  orca.commands.register('my.command', async (args) => ({ ok: true }))
  orca.events.on('worktree.created', async (payload) => {
    /* … */
  })
  const stored = await orca.host.call('storage.get', { key: 'state' })
  orca.log('activated')
}
export function deactivate() {}
```

El objeto `orca` son exactamente cuatro cosas
([`plugin-host-runtime.ts:20-36`](../../../src/main/plugins/plugin-host-runtime.ts)):
`commands.register`, `events.on`, `host.call(method, params)` y
`grantedCapabilities` (informativo: el host vuelve a comprobar cada llamada de todos modos),
más `log(message)`.

### Lo que el worker no puede hacer

Se ejecuta bajo el **modelo de permisos de Node**, con este `execArgv` fijo y nunca
los flags propios de Orca ([`plugin-worker-sandbox-args.ts:4-23`](../../../src/main/plugins/plugin-worker-sandbox-args.ts)):

```
--preserve-symlinks --preserve-symlinks-main
--permission
--allow-fs-read=<plugin root>
--allow-fs-read=<host entry dir>
--require <plugin-host-preload>
[--allow-child-process]      ← only with process:spawn
```

Léelo como una lista de ausencias:

- **Sin escrituras en el sistema de archivos. En ningún lado.** No hay `--allow-fs-write`. Persiste
  mediante `storage.*` / `secrets.*`.
- **Sin lectura fuera de tu propia carpeta**: ni `~/.config`, ni los repos
  del usuario, ni `~/.ssh`. Solo tu árbol de instalación y el directorio de entrada del host.
- **Sin procesos hijos** sin `process:spawn`.
- **Sin el `process.env` de la shell del usuario.** El worker recibe una allowlist de 19
  variables, más `ELECTRON_RUN_AS_NODE=1`
  ([`plugin-worker-env.ts:8-56`](../../../src/main/plugins/plugin-worker-env.ts)):
  `PATH`, `HOME`, `USERPROFILE`, `LANG`, `LC_ALL`, `LC_CTYPE`, `TZ`, `TMPDIR`,
  `TEMP`, `TMP`, `ORCA_USER_DATA_PATH`, `XDG_CONFIG_HOME`, `SYSTEMROOT` (que se pasa
  como `SystemRoot`), `SYSTEMDRIVE`, `WINDIR`, `COMSPEC`, `PATHEXT`,
  `PROCESSOR_ARCHITECTURE`, `NUMBER_OF_PROCESSORS`. Un token que exportaste en tu
  shell _no_ es visible para un plugin. En Windows la búsqueda ignora mayúsculas y minúsculas, porque
  las claves de entorno de Windows no distinguen mayúsculas y las de POSIX sí.
- **Sin módulos de red.** El preload lanza un error al importar `net`, `http`,
  `https`, `http2`, `tls`, `dns`, `dns/promises`, `dgram`
  ([`plugin-host-preload.ts:3-29`](../../../src/main/plugins/plugin-host-preload.ts)),
  elimina `WebSocket` y reemplaza `fetch` por uno que solo llega a los hosts
  que declaraste en `net:fetch`, con `redirect: 'manual'`, para que una redirección fuera de
  un host permitido no se siga ([`:66-84`](../../../src/main/plugins/plugin-host-preload.ts)).
- **Sin vías de escape nativas**: `process.binding`, `process._linkedBinding`,
  `process.getBuiltinModule` y `process.dlopen` quedan permanentemente como
  `undefined` ([`:95-100`](../../../src/main/plugins/plugin-host-preload.ts)).
- **Sin Electron.** La entrada se lanza con fork y `ELECTRON_RUN_AS_NODE`
  ([`plugin-host-entry.ts:1-6`](../../../src/main/plugins/plugin-host-entry.ts)).

Si _sí_ se concede `process:spawn`, ten en cuenta que la línea de consentimiento lo dice claramente:
los programas que inicia el plugin **no** están restringidos por nada de lo anterior.

### Timeouts y supervisión

| Límite | Valor |
| ------ | ----- |
| Listo tras la activación | 10 s ([`plugin-host-protocol.ts:108`](../../../src/shared/plugins/plugin-host-protocol.ts)) |
| Una invocación de comando | 30 s ([`:109`](../../../src/shared/plugins/plugin-host-protocol.ts)) |
| Un handler de evento | 5 min, luego se mata el worker ([`plugin-host-process.ts:23, 288-292`](../../../src/main/plugins/plugin-host-process.ts)) |
| Eventos en curso sin confirmar | 64, luego se mata ([`:24, 281-285`](../../../src/main/plugins/plugin-host-process.ts)) |
| Recogida por inactividad | 5 min sin trabajo en curso ([`plugin-host-protocol.ts:110-112`](../../../src/shared/plugins/plugin-host-protocol.ts)) |
| Workers vivos simultáneos | 5; las activaciones adicionales quedan en cola ([`:114`](../../../src/shared/plugins/plugin-host-protocol.ts)) |
| Margen de apagado antes de SIGKILL | 2 s ([`plugin-host-process.ts:22`](../../../src/main/plugins/plugin-host-process.ts)) |
| Reinicios por crash | 3, con esperas de 500 / 2000 / 5000 ms, luego `errored` ([`plugin-supervisor.ts:31-34`](../../../src/main/plugins/plugin-supervisor.ts)) |

El worker es **perezoso**: no se hace fork de nada hasta que se invoca un comando o llega un evento
suscrito ([`plugin-worker-manager.ts:46`](../../../src/main/plugins/plugin-worker-manager.ts),
[`plugin-event-delivery.ts:37-40`](../../../src/main/plugins/plugin-event-delivery.ts)).
Una suscripción en el manifiesto es un disparador de activación duradero; un
`events.subscribe` en tiempo de ejecución solo llega a un worker que ya está corriendo y muere con
él ([`plugin-event-bus.ts:1-49`](../../../src/main/plugins/plugin-event-bus.ts)).

Un refresco que cambia la especificación del worker de un plugin (su manifiesto, raíz o capabilities
concedidas) detiene el worker viejo. Si ese worker estaba corriendo y el plugin
sigue aprobado, Orca lo vuelve a iniciar con la nueva especificación sin esperar un
disparador ([`plugin-worker-controller.ts:129-150`](../../../src/main/plugins/plugin-worker-controller.ts)).
Si la actualización dejó al plugin pendiente de consentimiento, o el plugin se desactivó mientras
su worker corría, Orca recuerda ese worker y lo inicia en cuanto el plugin se
aprueba o se vuelve a activar; rechazar el diálogo de consentimiento o desinstalar el
plugin lo olvida ([`plugin-worker-restore.ts`](../../../src/main/plugins/plugin-worker-restore.ts)).
Un worker inactivo o que nunca se inició sigue detenido. Editar solo el código del worker,
con el manifiesto sin cambios, no lo detiene: el worker en ejecución conserva el código viejo
hasta que se detiene (recogida por inactividad, desactivar y volver a activar, o reiniciar la app).

### Payloads de eventos

Proyecciones acotadas, validadas antes de llegar a cualquier plugin
([`plugin-events.ts:14-63`](../../../src/shared/plugins/plugin-events.ts)):

- `worktree.created` → `{ worktreeId, path, branch }`
- `worktree.removed` → `{ worktreeId, path }`
- `agent.status.changed` → `{ worktreeId | null, paneKey, state, receivedAt, agentType?, sessionBoundary?, interrupted? }`
- `notification.dispatched` → `{ source, worktreeId | null, title, body, at }`

Los extras de `agent.status.changed` son opcionales y quedan ausentes en lugar de vacíos
([`plugin-agent-status-event.ts`](../../../src/main/plugins/plugin-agent-status-event.ts)).
`agentType` nombra al agente (`claude`, `codex`, …) y se omite cuando el hook
no lo indicó. Un valor más largo lo trunca a 40 caracteres el pipeline de hooks,
como en el resto de Orca. `sessionBoundary: true` aparece solo en un
`done` que marca una sesión que empieza, se reanuda o se limpia y queda inactiva, no un
turno terminado; un plugin que notifica al completar debería saltárselo.
`interrupted: true` aparece solo en un `done` que el usuario detuvo a mitad de turno. Los prompts,
las llamadas a herramientas y la salida del asistente nunca forman parte del payload.

`notification.dispatched` permite que un plugin sea un canal de entrega más para las
notificaciones que el propio Orca decidió mostrar: por ejemplo, un bridge de mensajería que reenvía
"agent needs input" a tu teléfono. Se dispara desde la misma distribución
que lee la app móvil emparejada
([`plugin-notification-event-bridge.ts`](../../../src/main/plugins/plugin-notification-event-bridge.ts)),
así que un plugin recibe exactamente lo que recibiría el teléfono:

- solo después de que el switch **Notifications** de Orca y el switch por origen
  (tarea de agente completada, campana de la terminal) lo permitan;
- una vez por ráfaga por worktree (el mismo cooldown de 5 s que el teléfono), e incluso
  cuando este equipo no muestra ningún banner: el worktree está enfocado, el cooldown
  del escritorio lo retiene, o el sistema operativo no admite o no permite notificaciones;
- nunca para la notificación de prueba de Settings, y nunca para una notificación que un
  plugin generó con `notifications.show` (origen `plugin`), para que los plugins no puedan
  hacerse eco entre sí.

`source` es la cadena de origen de Orca (`agent-task-complete`, `terminal-bell`);
`title` tiene como máximo 256 caracteres y `body` como máximo 1024, truncados con `…`;
`at` es el instante, en milisegundos desde epoch, en que Orca la retransmitió. El body muestra un adelanto de la
última respuesta o entrada de herramienta del agente, o, si no hay una captura reciente del agente, el título de la terminal
(que en Claude Code resume tu tarea), así que este evento necesita su propia
capability `notifications:observe` además de `events:subscribe`. El host
lo aplica dos veces: `events.subscribe` deja el evento fuera de la lista
`subscribed` que devuelve, y la entrega vuelve a comprobar las capabilities consentidas, así que un
plugin sin el permiso nunca recibe el evento
([`plugin-event-delivery.ts`](../../../src/main/plugins/plugin-event-delivery.ts)).
Un Orca Lab anterior a este evento rechaza un manifiesto que lo nombre, así que fija
`engines.orca` en la primera versión que lo incluye.

```json
{
  "main": "worker.mjs",
  "contributes": { "events": [{ "on": "notification.dispatched" }] },
  "capabilities": [{ "kind": "events:subscribe" }, { "kind": "notifications:observe" }]
}
```

```js
orca.events.on('notification.dispatched', async ({ source, title, body, worktreeId }) => {
  // Forward to your channel. The handler has 5 minutes before the worker is killed.
})
```

## Automatizaciones

`contributes.automations` declara trabajo programado que Orca crea para el usuario
cuando el plugin se activa y elimina cuando se desactiva o se desinstala
([`plugin-automation-contribution.ts:9-31`](../../../src/shared/plugins/plugin-automation-contribution.ts)).
Un plugin **no puede** crear una automatización mediante ninguna API: es declarativa
como `panels`.

Cada entrada lleva `id`, `title`, `trigger` (una expresión cron con al menos una
ejecución posible), `timezone` (una zona IANA), `precheck` opcional (shell, ≤ 1024
caracteres) y `workspace` opcional; y luego **exactamente uno** de:

- `provider` + `prompt`: lanza un agente; el cuerpo del prompt vive en un archivo
  dentro del plugin (≤ 128 KiB), nunca en línea, para que quien revisa lea los mismos
  bytes que cubre el hash de contenido ([`:34-36, 64-70`](../../../src/shared/plugins/plugin-automation-contribution.ts));
- `command`: un string de shell, ≤ 1024 caracteres, que _es_ la ejecución: sin agente, sin
  terminal, sin modelo ([`:43, 72-78`](../../../src/shared/plugins/plugin-automation-contribution.ts)).

Ambos esquemas son `.strict()`, de ahí una unión en lugar de dos campos opcionales.

Lo que garantiza el host
([`plugin-automation-reconciliation.ts:24-47`](../../../src/main/plugins/plugin-automation-reconciliation.ts)):

- **Nacen desactivadas.** Encender trabajo automático es decisión del usuario.
- Nacen **sin proyecto**, salvo que la declaración diga
  `"workspace": "plugin-owned"`, lo que pide una carpeta que Orca crea _para el
  plugin_, fuera de todo proyecto del usuario. Es un literal, no una ruta: un plugin nunca
  puede nombrar un directorio ni apuntar al repo de otra persona.
- La reconciliación se ejecuta en transiciones explícitas del ciclo de vida (consentimiento, activar,
  desactivar, desinstalar), no en cada refresco del descubrimiento, así que una carpeta de desarrollo
  intermitente no borra las filas del usuario.
- En una fila existente solo se refrescan los campos que son del plugin (título, prompt,
  comando de precheck, provider, cron, timezone), y solo si el usuario no los ha
  editado. Proyecto, workspace, modo, activado, timeouts y margen de ejecuciones perdidas
  son del usuario y nunca se tocan.

Una cosa para tener en cuenta en el diseño: el comando de una automatización **no** se ejecuta dentro del
sandbox del worker. Se lanza con `shell: true`, el directorio de trabajo del
workspace elegido y el `process.env` completo
([`precheck-runner.ts:130-136`](../../../src/main/automations/precheck-runner.ts)).
Además, no tiene idea de dónde está instalado tu plugin: la ruta de instalación es un
hash de contenido. Mantén el comando autocontenido y relativo a su directorio
de trabajo, o incluye un punto de entrada real y haz que el usuario apunte a él.

Como una automatización es contenido instructivo, declarar una ata el consentimiento al
hash de contenido; consulta más arriba. El diálogo de consentimiento muestra el trigger, el precheck
y el comando literalmente ([`plugin-automation-contribution.ts:110-131`](../../../src/shared/plugins/plugin-automation-contribution.ts)).

## Escenas del juego

Un plugin puede agregar conjuntos de arte al juego de Agent Teams
([`orchestrator-game.md`](./orchestrator-game.md)) como JSON plano. No se necesita
ni worker ni capability:

```json
"contributes": {
  "gameScenes": [{ "id": "night-shift", "path": "scenes/night-shift.json" }]
}
```

- `id` es kebab-case, único dentro del plugin, y nunca `quest` (la escena integrada). Como máximo 8
  por plugin; cada archivo de 64 KB como máximo, dentro de la carpeta del plugin (sin ruta absoluta, sin `..`, sin
  symlink hacia fuera: la misma contención que cualquier otro archivo declarado).
- El juego ve la escena como **`<publisher>.<id>/<scene id>`**, por ejemplo
  `orca-samples.worklog/night-shift`, así que dos plugins, o un plugin y `quest`, nunca chocan.
  Ese es el id que va en `orchestratorGame.scene` en `orca.yaml`, o el que eliges en
  Settings → Agents → **Agent Teams game** → **Scene**.
- Una escena son datos inertes que dibuja el mod incluido; nada la ejecuta y ningún agente la lee, así que
  **no** forma parte de la huella de consentimiento: editar una escena nunca vuelve a preguntar.

El archivo refleja el `SceneDefinition` del mod
([`scene-definition.ts`](../../../resources/claude-plugins/orca-game/hooks/scenes/scene-definition.ts))
y lo valida [`orchestrator-game-scene.ts`](../../../src/shared/orchestrator-game-scene.ts).
Cada fase (`working`, `docs`, `build`, `verify`, `pr`, `handoff`) debe estar presente en `looks`,
`costumes` y `cards`:

```jsonc
{
  "looks": {
    // one per phase: the landscape
    "working": {
      "skyTop": "#0d1330",
      "skyBottom": "#2a3466",
      "sun": "#f2f0d8",
      "isNight": true,
      "far": "#1f2748",
      "snow": "#8c97c4",
      "near": "#1b2b33",
      "ground": "#121c1e",
      "plant": "#0d1714",
      "plantKind": "tree",
      "cloud": "#2e3a66",
      "scenery": "skyline",
      "isSignal": true // both optional
    }
    // docs, build, verify, pr, handoff …
  },
  "costumes": {
    // one per phase: Clawd's outfit
    "working": {
      "rows": ["..........", "..HHHHH...", ".HHHHHHH..", ".OEOOOEO..", "OBBBBBBBO.", ".BBBBBBB.."],
      "legs": [".O.O.O.O..", "O.O.O.O.O."],
      "colors": { "O": "#d77757", "E": "#1a1a1a", "H": "#3a4a7a", "B": "#2a3a5a" }
    }
  },
  "cards": {
    "working": {
      "icon": "☾",
      "name": { "en": "Night Owl", "es": "Búho nocturno" },
      "color": "#8fa3d9"
    }
  },
  "teller": { "icon": "❝", "name": "Night Log", "color": "#9aa6c8" },
  "band": { "gold": "#f2c14e", "ink": "#0d1330", "panel": "#1f2748", "parchment": "#e8e4ff" },
  "foe": { "rows": ["…six rows…"], "legs": ["…", "…"], "colors": {} }, // optional
  "finale": { "en": "◆ CASE CLOSED", "es": "◆ CASO CERRADO" }, // optional
  "hud": {
    "skyTop": "#0d1330",
    "skyBottom": "#1f2748",
    "frame": "#f2c14e",
    "text": "#e8e4ff",
    "dim": "#9aa6c8",
    "star": "#ffffff"
  }, // optional, team band
  "cast": {
    // optional
    "pet": {
      "name": "Owl",
      "frames": [["O.O", "OOO", ".O."]],
      "happy": ["O.O", "OHO", ".O."],
      "colors": { "O": "#8fa3d9", "H": "#ff5a8a" }
    },
    "advisor": {
      "name": "Watchman",
      "frames": [[".K.", "KKK", "K.K"]],
      "colors": { "K": "#1a1a1a" }
    }
  }
}
```

- Los colores de píxel (`looks`, los `colors` de los costumes, `hud`) son `#rrggbb` o un entero `0..0xFFFFFF`; los colores de
  cards y band son `#rrggbb`.
- Un costume mide 10×7: exactamente seis `rows` de cuerpo más una séptima fila de piernas cuyos dos frames son los
  dos strings de `legs` (se alternan mientras camina; una figura sentada omite esa fila). Cada fila son
  diez glifos ASCII imprimibles. `.` es transparente y todo otro glifo debe tener un color. Nada se
  refleja cuando una figura camina de vuelta, así que dibuja los costumes mirando a la derecha, como mira el héroe.
- `icon` tiene como máximo 4 caracteres y `name` como máximo 32, sin caracteres de control ni bidi: llegan
  a la terminal tal cual.
- El `name` de una card o del teller es un string, o uno por idioma como `{ "en", "es" }`
  con `en` obligatorio; el juego muestra el del idioma de la UI de Orca y recurre a `en`. Las demás
  claves de idioma se descartan. Un mod más antiguo que esto descarta una escena que use la forma de objeto y
  dibuja `quest`.
- `plantKind` es la planta del borde del camino: `tree`, `cactus`, `none`, `antenna`, `crystal` o `flower`.
  `scenery`, opcional, es la capa lejana: `peaks` (por defecto), `skyline` (edificios con ventanas
  encendidas, sobre azoteas en lugar de colinas), `crystals` o `meadow`. `isSignal: true`, opcional, dibuja un
  cartel con reflector y su haz en lugar del sol.
- `foe`, opcional, es un costume, con las mismas reglas de arriba, que se enfrenta a un compañero cuyo CI está en rojo: en su
  tile del Fleet en lugar del objeto de la fase, reflejado para que mire al compañero, y por turnos con él
  en el HUD tal como está escrito.
- `finale`, opcional, es un rótulo pintado abajo a la derecha mientras corre un merge: un string o uno por
  idioma, como máximo 24 caracteres. Se dibuja dentro del pixel art, así que solo admite caracteres de ancho 1
  (latinos con tildes, puntuación, dibujo de cajas y bloques, `★`, palos de cartas).
- Un Orca o mod anterior a estos campos ignora `scenery`, `isSignal`, `foe` y `finale`; uno
  anterior a las plantas `antenna`, `crystal` y `flower` descarta una escena que las use y dibuja
  `quest`.
- `cast`, opcional, le da a la escena un `pet` (al que Pet le da corazones, y que sigue al héroe) y el
  `advisor` de Jev (que, si no, es el árbitro), cada uno con frames de sprite de 1 a 7 filas por 1 a 10 glifos. Un
  miembro inválido se deja fuera con una advertencia y la escena se sigue dibujando; las reglas y los gestos
  del advisor están en [El elenco](./orchestrator-game.md#el-elenco-una-mascota-y-el-advisor-de-jev).
- `themes`, opcional, contiene de 1 a 8 variantes de paleta, cada una con un `name`, un `weight` de 0 a 1 y un
  `look` con cualquiera de los colores del look; el color propio de cada fase se acerca al del tema
  en la proporción `weight`. El mod muestra uno al día, por turnos con los looks simples, en la zona horaria del proyecto
  ([`scene-theme.ts`](../../../resources/claude-plugins/orca-game/hooks/scenes/scene-theme.ts)). Los
  `themes` incorrectos se dejan fuera con una advertencia y la escena se sigue dibujando; un Orca o mod anterior a
  `themes` lo ignora y dibuja los looks simples.
- `roster`, opcional, lista los nombres que toman los miembros; una entrada puede darle a su nombre un look propio (una
  paleta `variant` y un accesorio, o `costumes`). Consulta
  [Personajes](./orchestrator-game.md#personajes-un-look-por-nombre-del-roster).
- Las claves desconocidas se ignoran, así que una escena escrita para un Orca más nuevo sigue cargando.

Orca lee los archivos de los plugins activados y consentidos en cada llamada a `orca game state` y envía las
válidas en `extensions.scenes`. Una escena inválida se descarta y se nombra en `warnings`
(`game scene <id> dropped: <reason>`); nunca hace fallar la llamada. Un id de escena que nada sirve
(desinstalada, desactivada o inválida) dibuja `quest`. `examples/plugins/worklog` incluye una completa
en `scenes/night-shift.json`.

## Ciclo de vida: qué estado muestra qué

El estado que viaja por el wire es uno de `running`, `restarting`, `idle`, `pending`,
`disabled`, `errored`, `invalid`
([`plugin-list-projection.ts:38-68`](../../../src/main/plugins/plugin-list-projection.ts)),
derivado en este orden de precedencia: disabled → pending → errored → restarting →
running/idle ([`:197-208`](../../../src/main/plugins/plugin-list-projection.ts)).

- `invalid`: el manifiesto falta, no se puede interpretar, no pasa la validación, declara un
  artefacto inexistente o requiere un Orca más nuevo.
- `pending`: instalado pero esperando consentimiento, o esperando _re_-consentimiento.
- `idle`: activado, sin worker corriendo. Es el estado normal de reposo.
- `errored`: se cayó más veces de las que permite el presupuesto de reinicios, o no logró activarse.

**Solo `running`, `restarting` e `idle` montan el documento de un panel**
([`plugin-panels.ts:19-21`](../../../src/renderer/src/store/plugin-panels.ts)).
Un plugin `pending` conserva su _superficie_ (la entrada de la barra lateral, la página de Settings),
pero renderiza un aviso de aprobación en lugar de tu HTML
([`plugin-panels.ts:26-28`](../../../src/renderer/src/store/plugin-panels.ts),
[`PluginPanel.tsx:156-161, 235-237`](../../../src/renderer/src/components/right-sidebar/PluginPanel.tsx)).
Es deliberado: sin eso, el panel desaparecería en silencio en cada actualización
y el usuario no tendría dónde enterarse del porqué. `errored` y `disabled` no montan
nada.

Si tu panel está en blanco después de una actualización, revisa el estado antes de depurar tu
HTML: el host nunca lo pidió.

## Publicación

### Estructura de la instalación

Las instalaciones son inmutables y direccionadas por hash, detrás de un cambio atómico de puntero
([`plugin-discovery.ts:26-36`](../../../src/main/plugins/plugin-discovery.ts)):

```
<userData>/plugins/<publisher>.<id>/current    ← text file naming the hash
<userData>/plugins/<publisher>.<id>/<hash>/    ← the install tree
```

El directorio de la versión anterior se conserva para hacer rollback de un paso
([`plugin-install.ts:35-44`](../../../src/main/plugins/plugin-install.ts)). **Ningún
script se ejecuta nunca durante la instalación**: el instalador copia archivos y nada más, así que
no hay hook `postinstall` ni paso de build. Incluye lo que quieras que se ejecute.

El árbol tiene un tope de **2 000 entradas y 50 MB**
([`plugin-content-hash.ts:15-16`](../../../src/main/plugins/plugin-content-hash.ts)),
que incluye todo lo que hay en la carpeta, no solo los artefactos declarados. Un
`node_modules` en el commit lo hará superar el tope.

### Orígenes

- **Ruta local**: la carpeta debe contener `orca-plugin.json`
  ([`plugin-install.ts:68-87`](../../../src/main/plugins/plugin-install.ts)).
- **URL de Git + ref**: solo HTTPS o SSH; Orca invoca el `git` _del sistema_
  con arrays de argv (nunca un string de shell, nunca un cliente incluido) para que tus
  credential helpers y remotos SSH sigan funcionando, y resuelve el ref a un
  commit exacto ([`:110-145`](../../../src/main/plugins/plugin-install.ts)).
- **Marketplace**: un repo de Git que contiene `orca-marketplace.json`
  ([`plugin-marketplace.ts:5, 101-119`](../../../src/shared/plugins/plugin-marketplace.ts)):
  `{ name, owner, plugins: [{ id, source: { kind: 'git', url, ref }, description?, categories? }] }`,
  hasta 2 048 entradas. El `id` de cada entrada es el `<publisher>.<id>` canónico con el que
  debe coincidir el manifiesto de origen, y `ref` es obligatorio: omitirlo y usar el valor por defecto del remoto
  haría que el listado no fuera reproducible. Los listados en las categorías `themes`, `icons`,
  `icon-themes`, `terminal-themes` o `skills` están ocultos en este
  build porque esas contribuciones todavía no se aceptan
  ([`:28-49`](../../../src/shared/plugins/plugin-marketplace.ts)).

La insignia "Official" la deriva el host y no se puede autoasignar: necesita la
identidad reservada `ab2web.orca-*`, servida desde la organización `ab2webco`, a través del
índice oficial ([`plugin-list-projection.ts:258-264`](../../../src/main/plugins/plugin-list-projection.ts),
[`plugin-marketplace.ts:16-26, 137-140`](../../../src/shared/plugins/plugin-marketplace.ts)).

### Actualizar

Una actualización se instala en un nuevo directorio de hash y cambia el puntero. Que al
usuario se le vuelva a preguntar depende solo de la huella: un conjunto de capabilities
cambiado, un `main` recién agregado o, para un plugin con contribuciones instructivas,
_cualquier_ cambio. El directorio de la versión vieja se queda para el rollback.

Sube `version` en el manifiesto para las personas; la identidad para el host es el hash
de contenido, no el string de versión.

## Checklist antes de publicar

- `orca-plugin.json` se interpreta bien; la comprobación más rápida es el test de fixture:
  `npx vitest run --config config/vitest.config.ts src/shared/plugins/plugin-demo-fixture.test.ts`
  con tu carpeta agregada.
- Ningún color literal en el panel; todo sale de los 22 tokens. Míralo en
  ambos temas y a 320 px.
- Nada de polling en el bridge; cada respuesta comprueba `ok` antes de `value`.
- El worker nunca escribe un archivo, lee fuera de su carpeta ni espera una variable de entorno
  aparte de las 19.
- Las rutas del manifiesto usan `/` y se quedan dentro de la carpeta del plugin.
- Nada grande en el commit: 2 000 entradas, 50 MB.
