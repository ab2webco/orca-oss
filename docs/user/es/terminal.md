---
sourceHash: 7261a1b778458d72
---
# Terminal

Cada worktree tiene pestañas de terminal. Una pestaña se puede dividir en panes, y cada pane ejecuta su propio
shell o agente.

## Pestañas y panes

- `Mod+T` abre una nueva pestaña de terminal.
- `Mod+Alt+T` abre una nueva pestaña de agente con el agente predeterminado en macOS.
- En macOS, `Cmd+D` divide el pane activo hacia la derecha y `Cmd+Shift+D` lo divide hacia abajo. En Windows y Linux, las teclas de división son `Ctrl+Shift+D` (derecha) y `Alt+Shift+D` (abajo).
- `Mod+]` y `Mod+[` mueven el foco al pane siguiente y al anterior.
- `Mod+Shift+Enter` expande o contrae el pane activo.
- `Mod+W` cierra el pane activo.
- `Mod+F` busca en el pane activo. `Mod+K` lo limpia.

## Entre reinicios

Las terminales se ejecutan en un proceso en segundo plano. Cuando vuelves a abrir Orca Lab, la app se reconecta a
las terminales que siguen en ejecución y restaura su salida reciente.

Las terminales en un host SSH siguen ejecutándose durante un periodo de gracia después de una desconexión.
Consulta [SSH](ssh.md).

Usa **Restart the terminal daemon** o **Kill all terminal sessions** en Settings solo cuando una terminal se
quede bloqueada. Terminar las sesiones finaliza los procesos en ejecución.
