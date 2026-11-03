---
sourceHash: f534814085cae35d
---
# Agentes compatibles

Orca Lab ejecuta agentes de programación en pestañas de terminal. Puede lanzar y seguir cualquier agente que se
ejecute como programa de línea de comandos, y tiene soporte de lanzamiento integrado para una lista de agentes
conocidos, entre ellos Claude Code, Codex, Gemini, Aider, Cursor, Copilot, Grok y OpenCode.

## Lanzar un agente

- Elige un agente al crear un worktree, o abre una nueva pestaña de agente con el agente predeterminado.
- Orca Lab busca el comando del agente en tu PATH. Instala primero el agente siguiendo su propia
  documentación.

## Hooks de estado

Para algunos agentes, Orca Lab instala hooks de estado para poder mostrar si un agente está trabajando,
esperándote o ha terminado. Los hooks informan a un listener local en tu máquina.

Desactiva **Agent status hooks** en Settings para que Orca Lab deje de instalar estos hooks y elimine los que
administra.

Los agentes sin hooks obtienen su estado del título de la terminal, así que el estado puede ser menos
preciso.

## Cuentas

Las cuentas de Claude y Codex se pueden agregar y cambiar en Orca Lab. Consulta
[Seguimiento de uso y cuentas](usage-tracking.md).
