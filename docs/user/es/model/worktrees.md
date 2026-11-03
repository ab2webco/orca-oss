---
sourceHash: af53c5a04809528f
---
# Worktrees

Un worktree es un checkout aparte de tu repositorio en su propia rama, creado con
`git worktree add`. Orca Lab le da a cada tarea su propio worktree, para que los agentes trabajen en paralelo
sin hacer stash ni cambiar de rama en tu checkout principal.

## Crear un worktree

- Pulsa `Mod+N` (o `Mod+Shift+N`) para abrir **Create worktree**. `Mod` es Cmd en macOS y Ctrl en Windows y Linux.
- El diálogo pide un proyecto y un nombre. También incluye un agente para lanzar, una nota opcional y opciones avanzadas como sparse checkout y reutilizar una rama existente.
- Los worktrees nuevos se crean en `~/orca/workspaces` de forma predeterminada.

## Cambiar entre worktrees

- `Mod+1` a `Mod+9` seleccionan un worktree por su posición en la barra lateral.
- `Mod+Shift+Up` y `Mod+Shift+Down` pasan al worktree anterior y al siguiente.
- `Mod+J` abre la paleta de cambio (consulta [Apertura rápida](quick-open.md)).

## Administrar worktrees

Haz clic derecho en un worktree de la barra lateral para:

- copiar su ruta, fijarlo o dejar de fijarlo, y marcarlo como leído o no leído
- moverlo a un estado
- definir o abrir un worktree padre
- suspenderlo, con o sin sus descendientes
- asignarle una cuenta de Claude
- eliminarlo, o eliminarlo junto con sus descendientes

El worktree principal de un proyecto no se puede eliminar. En su lugar, quita el proyecto.

## Ejecutar varios agentes a la vez

Cada worktree puede alojar sus propias terminales de agente, así que puedes darle una tarea a un agente y otra
tarea a un segundo agente, y luego comparar los resultados. Los agentes de un mismo proyecto también pueden
coordinarse a través de la [CLI](../cli/overview.md).
