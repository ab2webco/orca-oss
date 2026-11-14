---
sourceHash: f8f32e77254de328
---
# Agent Teams

Un equipo es un **líder** y sus **miembros**. El líder es una sesión de Claude que habla contigo, elige
tickets e inicia un miembro por ticket, cada uno en su propio worktree. Los miembros trabajan, abren su
pull request e informan; el líder te transmite solo lo que te necesita. El panel **Team** lo muestra
todo.

## Iniciar un líder

1. En el proyecto, abre **+** y elige **Claude Agent Teams** en **Agents**. Si no está en la lista,
   actívalo en **Settings > Agents**.
2. Ejecuta `/orca-game:lead`, u `orca game lead` desde esa terminal. La sesión se convierte en el
   líder del proyecto y carga las reglas del proyecto desde `orca.yaml`.
3. Para configurar `orca.yaml` (el tracker del To Do, las reglas del líder, la escena), ejecuta
   `/orca-game:setup` en un pane de Claude del proyecto.

Un proyecto tiene un líder. Cuando ya lo tiene, **+** muestra un grupo **Team** en lugar de una segunda
entrada **Claude Agent Teams**: **Go to lead** y **Add member…** mientras el líder está en marcha,
**Reopen team** y **Start fresh lead…** después de cerrarlo. `/orca-game:lead fresh` (`orca game lead
--fresh`) inicia una conversación de líder nueva en lugar de reabrir la anterior. Consulta
[Barra lateral y pestañas nuevas](../model/sidebar.md#el-menú-).

## Agregar miembros

- Pídeselo al líder con tus palabras ("toma ORCA-101 y ORCA-102").
- O abre **+ > Add member…**, elige una cuenta en **Member account** y un ticket del To Do.
- O ejecuta `orca game launch <ticket>` desde la terminal del líder. `--on <host>` inicia el miembro en
  un host de Orca Lab emparejado.

Cada miembro es un personaje durante toda su ejecución: el mismo nombre y retrato en su tarjeta, en su
terminal y en el historial.

## El panel Team

Abre **Team** en la barra de actividad de la barra lateral derecha. Sin equipo, el mismo elemento se
llama **Your work** y lista tus propias sesiones de agente.

- **Team**, solo con equipo: el líder, el advisor si está instalado y una tarjeta por miembro.
- **Activity**, solo sin equipo: el prompt, el paso actual, la pregunta, el modelo y la cuenta de
  cada sesión.
- **Inbox**: las preguntas para ti, con un contador rojo.
- **PRs**: los PR abiertos con su estado, y la cola de merge arriba.
- **Machines**: cada host con su memoria libre y cuántos agentes ejecuta.

En la pestaña **Team**:

- Haz clic en la tarjeta de un miembro para abrir su terminal y expandir la tarjeta: título del ticket,
  rama, última herramienta, PR con CI, ayudantes y el uso de 5 horas y semanal de la cuenta. Haz clic
  otra vez para plegarla.
- Una tarjeta que te necesita dice **Waiting for your answer** y tiene **Answer in Inbox**.
- Hacer clic en la fila del líder abre la sesión del líder.
- El engranaje abre **Project settings** del equipo.

## Responder desde el Inbox

**Inbox** tiene **For you**, **Waiting**, **Threads** y **Answered**. Las preguntas de este proyecto van
primero; las de otros proyectos quedan plegadas en **Other projects**. Cuando llega una pregunta nueva,
su notificación abre el panel en el Inbox. El teléfono muestra las mismas preguntas; consulta
[Móvil](../mobile.md).

## Del PR al merge

Un miembro pasa por **Planning**, **Coding**, **Testing** e **In PR**. Su tarjeta muestra el PR y su CI
(**CI running**, **CI green**, **CI failing**, **Merged**). Desde la terminal de un miembro,
`orca game state` informa el mismo CI como `review.ci` y el estado de merge de GitHub como
`review.mergeState`; solo `clean` puede hacer merge. Cuando el miembro termina,
`orca game sweep --close` lo registra en el historial y libera su pestaña.

## Apariencias, estilos y escenas

El panel tiene tres apariencias con los mismos datos y acciones: **Game** (una escena, niveles y XP),
**Display** (un carrusel de métricas del equipo) y **Plain**. En la apariencia **Game** la escena viene
en tres estilos, todos representan el estado real del trabajo, nunca un temporizador:

- **Pixel**: un huerto; el bancal de cada miembro crece con su fase, y el trabajo con merge llena cajas
  de cosecha.
- **Figures**: una torre de castillo por miembro que sube de los cimientos a terminada; las torres con
  merge se convierten en trofeos.
- **Office**: pizarras cuyas notas avanzan hacia terminado, con placas por cada merge. Con miembros en
  más de una máquina se convierte en un edificio con una planta por máquina, primero la del líder, y
  **All** muestra todas las plantas.

Un CI en rojo muestra la obra rota. Una escena es una de las incluidas (Quest, Night Watch, Crystal
Saga, Beast Tamer), una que agrega un plugin o un archivo de escena del proyecto. Pixel dibuja todas
las escenas. Cuando una escena no tiene arte para Figures u Office, una nota en Settings dice qué dibuja
el panel en su lugar: la oficina propia de Orca, o los personajes de la escena en Pixel. La vista previa
del estilo en Settings muestra el estilo elegido.

## Dónde están los ajustes

- **Settings > Agents > Panel**: escena, apariencia, estilo y los interruptores **PRs**, **Queue** y
  **Machines** para todos los proyectos.
- La página del proyecto en **Settings**, sección **Agent Teams game**: las mismas filas para un
  proyecto, cada una con **Inherit**, más **Advisor**, **Arcade** y un archivo de escena propio.
- `orca.yaml`: `orchestratorGame.panel` (`look`, `style`, `tabs`, `advisor`, `arcade`),
  `orchestratorGame.scene` y `orchestratorGame.sceneFile`, compartidos con todos en el repo.

Cada capa posterior manda: los Settings globales, luego `orca.yaml`, luego los Settings del proyecto en
esta máquina. Un proyecto nuevo empieza en **Game**, **Pixel** y la escena Quest.

**Settings > Appearance > Status colors** define un color por estado (**Needs you**, **At risk**,
**Working**, **Verified**, **Idle**), para claro y oscuro. El panel y la escena los usan.

## La banda de la terminal

La banda pixel sobre el prompt del líder está apagada por defecto. Actívala con **Show the band** en
**Terminal band** dentro de **Settings > Agents > Agent Teams game**, o eligiendo Zen o una vista 2D en
**Default view**. **Render**, **Time zone** y **Teammate HUD** aparecen mientras está activa. Un pane
toma la banda al iniciarse.

## Historial y lecciones

- `orca game history` lista los miembros liberados del proyecto con su resultado, PR y personaje.
- Cuando un miembro termina, Orca guarda una lección breve de su resultado (merge, fallo, límite de la
  cuenta alcanzado) durante 30 días. Los miembros nuevos reciben las lecciones del proyecto en su brief
  de lanzamiento, marcadas como datos, no como instrucciones.
- Si el repo de un proyecto se eliminó y se volvió a agregar,
  `orca game adopt-history --from-repo-id <id>` trae su historial y sus lecciones.
- Tras reiniciar Orca Lab, `orca game resume-members` recupera los miembros que quedaron en pausa.

Todos los comandos de `orca game` están en la página de la [CLI](../cli/overview.md#dirigir-un-equipo-orca-game).
El comportamiento completo está en la [referencia de Orca Game](../../../reference/es/orchestrator-game.md).
