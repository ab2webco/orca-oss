---
sourceHash: e189955e1f680747
---
# Barra lateral y pestañas nuevas

La barra lateral izquierda lista cada workspace de cada host, una línea por cada uno. El botón **+**
al final de la barra de pestañas abre terminales, agentes y, en un proyecto con líder, su equipo.

## Hosts y filas

- Cada host es una fila del árbol con su nombre y cuántos de sus workspaces están activos, es decir,
  con un agente trabajando o esperando tu permiso. Tu propia máquina se llama **This computer** aquí y
  en todos los demás sitios donde Orca Lab nombra un host, salvo que la hayas renombrado.
- Cuando un host tiene un problema, el contador deja paso a **Update required**, **Authentication
  needed** o **Disconnected**.
- Los proyectos y las organizaciones cuelgan directamente de su host, y cada workspace es una fila.
- El líder y los miembros de un equipo se dibujan como filas de agente: un punto de estado, un icono
  de PR coloreado según su CI (o un icono de rama), el nombre y la antigüedad. El líder lleva una
  corona y su rama; sus miembros van debajo, y uno que te necesita muestra un signo de interrogación.

## Agrupar y filtrar

Abre **Workspace options** (el botón de controles deslizantes en la parte superior de la lista).

- **Group by** acepta **None**, **Status**, **PR** o **Project**. **Status** agrupa las filas en
  **Needs you**, **Working** e **Idle**; **PR** en **With PR** y **Without PR**. **Project order**
  (**Manual** o **Recent**) aparece mientras agrupas por proyecto.
- **Show** elige hosts y proyectos cuando tienes más de uno.
- **Filters** oculta los workspaces dormidos (opcionalmente salvo la rama por defecto), la rama por
  defecto, los workspaces creados por una automatización o por la CLI, los workspaces de otros
  clientes y los HEAD separados. El botón de opciones muestra cuántos filtros están activos.

Cuando los filtros ocultan algo, una línea bajo la lista dice cuántas filas están ocultas; **View
filters** en esa línea abre el mismo menú.

## Qué muestra una fila

**Card layout** (**Detailed** o **Compact**) y **Show properties** en el mismo menú eligen qué lleva
cada fila.

Con **Settings > Experimental > New card style** activado, el menú muestra **Card display** en su
lugar, en tres grupos:

| Grupo  | Propiedades                                                                         | Activadas por defecto            |
| ------ | ----------------------------------------------------------------------------------- | -------------------------------- |
| Work   | GitHub issues, Linear issues, Jira issues, Plane work items, Pull request and checks, Notes | Todas menos Notes        |
| Agent  | Agent statuses, Account, Model and effort                                           | Agent statuses                   |
| Source | Branch name, Ports, Automation, Orca Lab CLI                                        | Ninguna                          |

Las marcas de estado y de no leído siempre se muestran. Si nunca cambiaste tus propiedades, pasan a
estos valores por defecto; un perfil que personalizaste conserva sus elecciones.

## El menú +

**+** (**New tab**) abre un menú con hasta tres grupos:

- **Team**, solo en un proyecto que tiene líder:
  - Con el líder en marcha: **Go to lead** abre la sesión del líder, y **Add member…** lista el To Do
    del proyecto con un selector **Member account**. Elegir un ticket pide al líder que inicie un
    miembro para él.
  - Con el líder cerrado pero conservado: **Reopen team** recupera al líder en su cuenta, y **Start
    fresh lead…** pide confirmación y luego inicia un líder nuevo (`/orca-game:lead fresh`) en la
    cuenta que elijas.
- **Terminal**: **New Terminal** (y cada shell de Windows), **New Browser Tab**, el emulador móvil y
  los archivos Markdown.
- **Agents**: cada agente que Orca Lab detectó. **Claude Agent Teams** sale de esta lista mientras el
  proyecto tiene líder, para que no inicies un segundo.

El To Do de **Add member…** sale de cada tracker vinculado al proyecto: la entrada
`orchestratorGame.todo` de `orca.yaml`, el proyecto de Plane vinculado, la clave de Jira o Linear del
ticket del worktree y los issues de GitHub o GitLab del repositorio. Cada fuente recibe una parte
justa de la lista.
