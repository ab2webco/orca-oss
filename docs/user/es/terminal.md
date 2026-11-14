---
sourceHash: 2b5cf57193d559ed
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

## Pestañas en una ventana estrecha

Las pestañas se encogen a medida que la ventana se estrecha. Por debajo de unos 120 píxeles de barra
de pestañas, como en un pane del ancho de un teléfono, cada pestaña muestra solo su icono, al pasar el
puntero sobre una pestaña el icono se cambia por su botón de cerrar, y un botón **+N** cuenta las demás
pestañas. Haz clic en él para listarlas por nombre y elegir una.

## Windows y WSL

**Settings > Terminal > Windows Shell** define el **Default Shell** de los panes nuevos (PowerShell,
Command Prompt, Git Bash cuando está instalado) y el **Default project runtime**: **Windows** o
**WSL** con una distro. Los proyectos heredan ese runtime salvo que un proyecto lo cambie.

- Las terminales que no pertenecen a ningún proyecto, como un workspace de carpeta o la terminal
  flotante, siguen el mismo valor: con **WSL** elegido se abren en esa distro. Un shell que eliges
  para una pestaña sigue mandando.
- Una distro que instalas con Orca Lab abierto aparece en la lista de distros sin reiniciar:
  Settings vuelve a comprobar cuando su lista tiene un minuto.

## Entre reinicios

Las terminales se ejecutan en un proceso en segundo plano. Cuando vuelves a abrir Orca Lab, la app se reconecta a
las terminales que siguen en ejecución y restaura su salida reciente.

Las terminales en un host SSH siguen ejecutándose durante un periodo de gracia después de una desconexión.
Consulta [SSH](ssh.md).

Usa **Restart the terminal daemon** o **Kill all terminal sessions** en Settings solo cuando una terminal se
quede bloqueada. Terminar las sesiones finaliza los procesos en ejecución.
