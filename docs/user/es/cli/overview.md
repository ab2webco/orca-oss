---
sourceHash: fd11706a8f6aa362
---
# CLI

El comando `orca` controla una instancia de Orca Lab en ejecución desde cualquier terminal. Los scripts y los
agentes lo usan para crear worktrees, controlar terminales, coordinar agentes y compartir artifacts.

## Instalación

Abre **Settings > General > Orca Lab CLI** y elige **Register** en **Shell command**.

- En macOS, Orca Lab enlaza `orca` en `/usr/local/bin`, o en `~/.local/bin` cuando esa carpeta
  existe y `/usr/local/bin` no.
- En Windows, Orca Lab agrega la carpeta del comando a tu PATH de usuario.
- En los builds AppImage de Linux, Orca Lab instala un script envoltorio.
- WSL tiene su propia entrada **WSL shell command**.

Usa **Remove** en el mismo lugar para deshacer el registro.

## Grupos de comandos principales

- `orca open` y `orca status`: inician Orca Lab y comprueban que está en ejecución.
- `orca worktree`: crea, lista, muestra, configura y elimina worktrees.
- `orca terminal`: crea, lista, lee, divide y cierra terminales, les envía texto y espera en ellas.
- `orca orchestration`: envía mensajes, hace preguntas y despacha tareas entre agentes.
- `orca account`: lista las cuentas y su cuota en caché, agrega una cuenta y cambia de cuenta de Claude.
- `orca artifacts`: comparte, actualiza, lista, elimina y deja de compartir artifacts HTML o Markdown.
- `orca plane` y `orca linear`: leen y actualizan las tareas vinculadas.

Ejecuta `orca --help` u `orca <group> --help` para ver la lista completa de subcomandos y opciones.

## Cómo se conecta

La CLI lee un archivo de runtime en la carpeta de datos de Orca Lab y se comunica con la app en ejecución por un
socket local. Necesita que Orca Lab esté en ejecución, excepto para `orca open`.
