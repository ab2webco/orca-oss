"""Normaliza el texto de un comando de Bash antes de que una guarda lo analice.

Why: el cuerpo de un heredoc es un dato, no el comando. Analizarlo como si fuera
el comando produjo cuatro bloqueos falsos en una sesión (ORCA-362): escribir un
documento cuyo texto decía "push notifications" activó `main-merge-guard`, y el
cuerpo de un PR de release que *lista* sus tickets hizo que `board-state-guard`
atribuyera el PR al primero mencionado.
"""

import re

# `<<EOF`, `<<-EOF`, `<<'EOF'`, `<<"EOF"`, y el delimitador de cierre en su
# propia línea. El cuerpo se reemplaza por un marcador para que la forma del
# comando —la redirección— siga siendo legible por la guarda.
_HEREDOC = re.compile(
    r"<<-?\s*(?P<q>['\"]?)(?P<tag>[A-Za-z_][A-Za-z0-9_]*)(?P=q)\r?\n"
    r".*?"
    r"^\s*(?P=tag)\s*$",
    re.DOTALL | re.MULTILINE,
)


def strip_heredocs(command: str) -> str:
    """El comando sin los cuerpos de sus heredocs."""
    return _HEREDOC.sub("<<HEREDOC", command)
