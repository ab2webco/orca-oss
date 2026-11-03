---
sourceHash: a4a524459ec4ff3d
---
# Instalación

Orca Lab se distribuye desde la [página de releases de GitHub](https://github.com/ab2webco/orca-oss/releases/latest).
Cada release incluye un build para cada plataforma de escritorio y los manifiestos de actualización que la app usa
para actualizarse sola, sin reinstalarla.

## Builds de escritorio

| Plataforma            | Archivo                                                                                                      |
| --------------------- | ------------------------------------------------------------------------------------------------------------ |
| macOS (Apple Silicon) | [`orca-macos-arm64.dmg`](https://github.com/ab2webco/orca-oss/releases/latest/download/orca-macos-arm64.dmg) |
| macOS (Intel)         | [`orca-macos-x64.dmg`](https://github.com/ab2webco/orca-oss/releases/latest/download/orca-macos-x64.dmg)     |
| Windows               | [`orca-windows-setup.exe`](https://github.com/ab2webco/orca-oss/releases/latest/download/orca-windows-setup.exe) |
| Linux x64             | [`orca-linux.AppImage`](https://github.com/ab2webco/orca-oss/releases/latest/download/orca-linux.AppImage), o el `.deb` de la página del release |

El build de Linux está pensado para Ubuntu 20.04 estándar y versiones más recientes (glibc 2.31). En Windows, los
worktrees pueden estar dentro de WSL, y la CLI tiene su propio comando de shell para WSL.

## El comando `orca`

Abre **Settings > General > Orca Lab CLI** y elige **Register** en **Shell command**. A partir de ahí, los agentes
y los scripts controlan Orca Lab desde cualquier terminal. Consulta la [guía de la CLI](cli/overview.md).

## Sin ventana

Para ejecutar Orca Lab en un servidor y emparejarlo como host de miembros remotos, ejecuta `orca serve` en una
máquina Linux sin interfaz gráfica. La [guía del servidor Linux sin interfaz](../../reference/es/headless-linux-server.md)
cubre la unidad de servicio, el emparejamiento y las actualizaciones.

## Teléfono

La app complementaria se empareja con el escritorio desde **Settings > Mobile**. Consulta [Móvil](mobile.md).
