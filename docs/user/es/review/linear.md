---
sourceHash: 8cecd0289b01ec92
---
# Tareas de Linear y Plane

Orca Lab puede mostrar issues de Linear y Plane en su página Tasks, iniciar un worktree a partir de un issue y
pasarle el issue al agente como contexto. Las tareas de GitHub y GitLab funcionan de la misma manera.

## Conectar un gestor de issues

- **Linear:** introduce una API key personal en el diálogo de Linear.
- **Plane:** introduce la URL base de tu servidor de Plane, tu workspace y un token de acceso personal.
  El token se guarda en tu máquina, cifrado cuando tu sistema lo admite.

Plane aparece de forma predeterminada en el selector de fuentes de Tasks. Para ocultarlo, desactiva el ajuste de
visibilidad **Plane**. Su sección de configuración aparece una vez que Plane está conectado.

## Iniciar un worktree a partir de un issue

- Abre el issue desde la página Tasks e inicia un workspace a partir de él.
- El nuevo worktree registra el issue vinculado. Orca Lab rellena el primer mensaje del agente a partir de la
  **Launch prompt template**, que de forma predeterminada incluye el identificador y el enlace del issue. Puedes
  editar la plantilla en Settings.

## Vincular un pull request o un issue a mano

Abre el diálogo de detalles del workspace e introduce un número de PR o una URL de GitHub, o un número de issue o
una URL de GitHub. Deja un campo vacío para quitar el vínculo.
