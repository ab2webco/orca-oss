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
    r"<<-?\s*(?P<q>['\"]?)(?P<tag>[A-Za-z_][A-Za-z0-9_]*)(?P=q)(?P<rest>[^\n]*?)\r?\n"
    r".*?"
    r"^\s*(?P=tag)\s*$",
    re.DOTALL | re.MULTILINE,
)


def strip_heredocs(command: str) -> str:
    """El comando sin los cuerpos de sus heredocs."""
    # Why keep `rest`: the opener line goes on after the tag (`> file`, `&& gh ...`).
    return _HEREDOC.sub(lambda m: "<<HEREDOC" + m.group("rest"), command)


# Longest first, so `>>` is not read as `>` followed by a target starting with `>`.
_REDIRECT_OPS = ("&>>", "<<<", "<<-", "&>", ">>", ">&", ">|", "<&", "<>", "<<", ">", "<")
_WORD_END = set(" \t\n;&|()<>")


def strip_redirections(command: str) -> str:
    """The command without its unquoted redirections (`2>&1`, `>file`, `&>/dev/null`).

    Why: a redirect is the shell's, not the program's; read as arguments, `2>&1` made the
    lead's queue command look like it named three PRs (ORCA-987).
    """
    out: list[str] = []
    word_start = 0
    quote = ""
    i = 0
    while i < len(command):
        char = command[i]
        if quote:
            out.append(char)
            if char == "\\" and quote == '"' and i + 1 < len(command):
                out.append(command[i + 1])
                i += 1
            elif char == quote:
                quote = ""
            i += 1
            continue
        if char == "\\" and i + 1 < len(command):
            out.append(command[i : i + 2])
            i += 2
            continue
        if char in "'\"":
            quote = char
            out.append(char)
            i += 1
            continue
        op = next((o for o in _REDIRECT_OPS if command.startswith(o, i)), None)
        # `<(` and `>(` are process substitution, not a redirect.
        if op is None or command.startswith("(", i + len(op)):
            if char in _WORD_END:
                word_start = len(out) + 1
            out.append(char)
            i += 1
            continue
        # Why only a whole word of digits: `2>&1` names fd 2, `885 >&2` keeps 885 as an argument.
        prefix = "".join(out[word_start:])
        if prefix.isdigit():
            del out[word_start:]
        i += len(op)
        while i < len(command) and command[i] in " \t":
            i += 1
        target_quote = ""
        while i < len(command) and (target_quote or command[i] not in _WORD_END):
            if target_quote:
                if command[i] == target_quote:
                    target_quote = ""
            elif command[i] in "'\"":
                target_quote = command[i]
            elif command[i] == "\\":
                i += 1
            i += 1
        out.append(" ")
        word_start = len(out)
    return "".join(out)
