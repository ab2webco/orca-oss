---
sourceHash: 874d37a79aed2dbf
---
# SSH

Orca Lab puede crear worktrees y terminales en una máquina remota por SSH, para que los agentes se ejecuten junto
al código.

## Agregar un host

- Haz clic en **Add Target** para introducir un host a mano, o en **Import** para elegir hosts de `~/.ssh/config`.
- Un host puede usar un puerto, un archivo de identidad, ssh-agent, un ProxyCommand o un ProxyJump.
- Orca Lab pide una frase de contraseña o una contraseña cuando el host la necesita. Solo la guarda en memoria durante la sesión.

## Qué se ejecuta en el host remoto

La primera vez que te conectas, Orca Lab sube un pequeño relay de Node.js a `~/.orca-remote` en el host remoto
y lo inicia por SSH. El relay ejecuta las terminales, los worktrees de git y las operaciones de archivos en esa
máquina.

El host remoto necesita:

- Node.js 18 o posterior, y npm.
- Herramientas de compilación (make, un compilador de C++ y python3) cuando el relay tiene que compilar el módulo de terminal.

Se admiten hosts Linux, macOS y Windows, en x64 y arm64.

## Reconexión

Las terminales remotas siguen ejecutándose durante un periodo de gracia después de una desconexión. En **Remote
Terminal Persistence**, elige cuánto tiempo conservarlas. El valor predeterminado las conserva hasta que las
reinicies. Orca Lab permite como máximo 7 días.

## Qué se guarda en tu máquina

La configuración de los hosts se guarda en el archivo de datos de Orca Lab en tu máquina. Las contraseñas y las
frases de contraseña no se guardan.
