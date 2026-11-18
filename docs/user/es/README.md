---
sourceHash: 1194db3cd3065065
---
# Documentación de usuario de Orca Lab

Orca Lab es una app de escritorio para ejecutar varios agentes de programación en paralelo, cada uno en su propio
worktree de git, con terminales, un explorador de archivos, un navegador integrado y vínculos de tareas a tu gestor
de issues.

## Temas

- [Instalación](install.md): builds de escritorio para macOS, Windows y Linux, la CLI y hosts sin interfaz gráfica.
- [Proyectos y espacios de trabajo](projects.md): agrega un repositorio o una carpeta, un espacio por tarea, la barra lateral, las pestañas, las terminales y el navegador.
- [Un agente hasta un PR mergeado](one-agent.md): lee el estado de un agente, abre el pull request, revisa checks y comentarios, y mergea, en GitHub o GitLab.
- [Trackers y tareas](review/linear.md): conecta GitHub, GitLab, Linear, Jira y Plane, la página Tasks, un espacio de trabajo desde un ticket, y el To Do de un equipo.
- [Worktrees](model/worktrees.md): un worktree de git aislado por tarea, y cómo cambiar entre ellos.
- [Apertura rápida](model/quick-open.md): busca archivos y salta a worktrees, chats y acciones.
- [Barra lateral y pestañas nuevas](model/sidebar.md): hosts, agrupación y filtros, y el menú **+**.
- [Terminal](terminal.md): pestañas, divisiones, ventanas estrechas, Windows y WSL, y qué sobrevive a un reinicio.
- [Agentes compatibles](agents/supported.md): qué agentes de programación puede lanzar y seguir Orca Lab.
- [Seguimiento de uso y cuentas](agents/usage-tracking.md): uso de los límites de tasa, cambio de cuentas y tokens de Claude de larga duración.
- [Agent Teams](agents/agent-teams.md): un líder y sus miembros, el panel Team, las escenas y el Inbox.
- [Escenas, estilos y ajustes](agents/scenes-and-settings.md): las apariencias y escenas del panel, qué capa de ajustes gana, qué cambia al momento y un proyecto existente.
- [Hosts emparejados y SSH](ssh.md): empareja otra máquina con Orca Lab o agrega un host SSH, trabaja ahí y lanza miembros en un host emparejado.
- [Anotar diffs de IA](review/annotate-ai-diff.md): deja notas en un diff y envíalas a un agente.
- [Explorador de archivos](editing/file-explorer.md): explora, edita y arrastra archivos.
- [Visores de archivos](editing/viewers.md): imágenes, PDF, Markdown y otros tipos de archivo.
- [Navegador y Design Mode](browser/design-mode.md): previsualiza páginas y envía comentarios sobre elementos a un agente.
- [Plugins, el asesor y skills](plugins-and-skills.md): activa los plugins, instala y revisa uno, el asesor Jev y las skills que cargan tus agentes.
- [CLI](cli/overview.md): automatiza Orca Lab desde una terminal con el comando `orca`.
- [Artefactos y automatizaciones](artifacts-and-automations.md): comparte un archivo como enlace público, y ejecuta un agente según un horario.
- [Móvil](mobile.md): instala y empareja la app del teléfono, mira el equipo y las cuentas de cada escritorio y responde al líder.
- [Ajustes y solución de problemas](settings-and-troubleshooting.md): dónde vive cada ajuste y qué capa gana, y qué hacer cuando un login, un límite, un miembro o el CI se interponen.
- [Telemetría y privacidad](telemetry.md): qué datos envía Orca Lab y cómo desactivarlo.

Las notas de versión se publican en la [página de releases de GitHub](https://github.com/ab2webco/orca-oss/releases).
