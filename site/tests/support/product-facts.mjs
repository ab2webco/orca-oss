import { readFileSync } from 'node:fs'
import path from 'node:path'
import { REPO_DIR } from './built-html.mjs'

const read = (relativePath) => readFileSync(path.join(REPO_DIR, relativePath), 'utf8')

// Read from the app's source so a new agent or provider turns this suite red until
// the landing names it.
export async function loadProductFacts() {
  const { TASK_PROVIDERS } = await import(path.join(REPO_DIR, 'src/shared/task-providers.ts'))
  const { TUI_AGENT_DISPLAY_NAMES } = await import(
    path.join(REPO_DIR, 'src/shared/tui-agent-display-names.ts')
  )
  const pane = read('src/renderer/src/components/settings/IntegrationsPane.tsx')
  const sourceControlImport =
    /import\s*\{([^}]*)\}\s*from\s*'\.\/source-control-integration-cards'/.exec(pane)
  if (!sourceControlImport) {
    throw new Error('IntegrationsPane.tsx no longer imports source-control-integration-cards')
  }
  const prCards = [...sourceControlImport[1].matchAll(/(\w+)IntegrationCard/g)].map((m) => m[1])
  return {
    taskProviders: TASK_PROVIDERS.map((id) => TASK_PROVIDER_LABELS[id] ?? id),
    prProviders: prCards.map((card) => PR_PROVIDER_LABELS[card] ?? card),
    agents: Object.values(TUI_AGENT_DISPLAY_NAMES)
  }
}

const TASK_PROVIDER_LABELS = {
  github: 'GitHub',
  gitlab: 'GitLab',
  linear: 'Linear',
  jira: 'Jira',
  plane: 'Plane'
}

const PR_PROVIDER_LABELS = {
  GitHub: 'GitHub',
  GitLab: 'GitLab',
  Bitbucket: 'Bitbucket',
  AzureDevOps: 'Azure DevOps',
  Gitea: 'Gitea'
}

export const PLATFORMS = [
  'macOS',
  'Apple Silicon',
  'Intel',
  'Windows',
  'WSL',
  'Linux',
  'Ubuntu 20.04',
  'iOS',
  'TestFlight',
  'Android'
]

// Features we must not advertise: unmerged or unverified (ORCA-958 brief).
export const NOT_ADVERTISED = [/cmux/i, /Orca Cloud/i, /stacked[- ]PR/i]
