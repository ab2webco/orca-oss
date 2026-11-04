#!/usr/bin/env python3
"""Resuelve la CLI de Orca para los hooks, sin ejecutar ningún candidato.

Why: en Linux un `orca` suelto puede ser el lector de pantalla de GNOME, que ignora
argumentos inválidos y se queda corriendo; por eso Orca instala ahí `orca-ide`. Se decide por
nombre y nunca por `--version`: probarlo sería arrancar justo lo que se quiere evitar.
"""

import os
import shutil
import sys
from typing import Mapping, Optional

LINUX_SHIM_DIR = "linux-orca-cli-shim"
# Why una lista de permitidos: sólo acá instala Orca un `orca`; en otro Unix puede ser el lector.
BARE_ORCA_PLATFORMS = ("darwin", "win32")


def linux_shim(path: Optional[str]) -> Optional[str]:
    """El `orca` que Orca pone en el PATH de sus terminales de Linux."""
    for directory in (path or "").split(os.pathsep):
        if os.path.basename(directory.rstrip(os.sep)) == LINUX_SHIM_DIR:
            found = shutil.which("orca", path=directory)
            if found:
                return found
    return None


def resolve_orca_cli(
    env: Optional[Mapping[str, str]] = None, platform: str = sys.platform
) -> Optional[str]:
    """La CLI de Orca, o None si en este host no hay una que sea seguro ejecutar."""
    env = os.environ if env is None else env
    explicit = env.get("ORCA_CLI_COMMAND") or env.get("ORCA_GAME_CLI")
    if explicit:
        return explicit
    path = env.get("PATH")
    found = shutil.which("orca-ide", path=path) or linux_shim(path)
    if found or platform not in BARE_ORCA_PLATFORMS:
        return found
    return shutil.which("orca", path=path)


if __name__ == "__main__":
    resolved = resolve_orca_cli()
    if resolved is None:
        sys.exit(1)
    print(resolved)
