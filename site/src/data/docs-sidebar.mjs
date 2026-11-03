// Only pages that scripts/sync-docs.mjs writes; a slug that does not exist fails the build.
const group = (label, es, items) => ({ label, translations: { es }, items })
const page = (slug) => ({ slug })

export const docsSidebar = [
  group('Start here', 'Empieza aquí', [page('docs'), page('docs/install')]),
  group('Workspaces', 'Espacios de trabajo', [
    page('docs/model/worktrees'),
    page('docs/model/quick-open'),
    page('docs/terminal')
  ]),
  group('Agents', 'Agentes', [page('docs/agents/supported'), page('docs/agents/usage-tracking')]),
  group('Orchestrator', 'Orquestador', [page('docs/orchestrator/orca-game')]),
  group('Review', 'Revisión', [page('docs/review/annotate-ai-diff'), page('docs/review/linear')]),
  group('Editing', 'Edición', [page('docs/editing/file-explorer'), page('docs/editing/viewers')]),
  group('Browser', 'Navegador', [page('docs/browser/design-mode')]),
  group('Remote', 'Remoto', [page('docs/ssh'), page('docs/remote/headless-linux-server')]),
  group('CLI', 'CLI', [page('docs/cli/overview')]),
  group('Extend', 'Extender', [page('docs/extend/plugins'), page('docs/extend/orca-sonar')]),
  group('Mobile', 'Móvil', [page('docs/mobile')]),
  group('Privacy', 'Privacidad', [page('docs/telemetry')])
]
