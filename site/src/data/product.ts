// Product facts the landing renders. Agents and task providers come straight from the
// app's source so the page cannot drift from what Orca Lab actually launches.
import { TASK_PROVIDERS, type TaskProvider } from '../../../src/shared/task-providers'
import { TUI_AGENT_DISPLAY_NAMES } from '../../../src/shared/tui-agent-display-names'

export type Lang = 'en' | 'es'

export const REPO_URL = 'https://github.com/ab2webco/orca-oss'
export const RELEASES_URL = `${REPO_URL}/releases/latest`
export const ANDROID_RELEASES_URL = `${REPO_URL}/releases?q=mobile-android`

const TASK_PROVIDER_LABELS: Record<TaskProvider, string> = {
  github: 'GitHub',
  gitlab: 'GitLab',
  linear: 'Linear',
  jira: 'Jira',
  plane: 'Plane'
}

export const taskProviders = TASK_PROVIDERS.map((id) => ({ id, label: TASK_PROVIDER_LABELS[id] }))

// Settings → Integrations → Review providers (IntegrationsPane.tsx).
export const reviewProviders = ['GitHub', 'GitLab', 'Bitbucket', 'Azure DevOps', 'Gitea']

export const agents: string[] = Object.values(TUI_AGENT_DISPLAY_NAMES)

export type Download = {
  os: string
  detail: string
  file: string
  href: string
}

export const desktopDownloads: Download[] = [
  {
    os: 'macOS',
    detail: 'Apple Silicon',
    file: 'orca-macos-arm64.dmg',
    href: `${REPO_URL}/releases/latest/download/orca-macos-arm64.dmg`
  },
  {
    os: 'macOS',
    detail: 'Intel',
    file: 'orca-macos-x64.dmg',
    href: `${REPO_URL}/releases/latest/download/orca-macos-x64.dmg`
  },
  {
    os: 'Windows',
    detail: 'x64 · WSL',
    file: 'orca-windows-setup.exe',
    href: `${REPO_URL}/releases/latest/download/orca-windows-setup.exe`
  },
  {
    os: 'Linux',
    detail: 'x64 · Ubuntu 20.04+',
    file: 'orca-linux.AppImage',
    href: `${REPO_URL}/releases/latest/download/orca-linux.AppImage`
  }
]

/** Prefixes a site path with the configured base (import.meta.env.BASE_URL). */
export function withBase(path: string): string {
  const base = import.meta.env.BASE_URL.replace(/\/$/, '')
  return `${base}/${path.replace(/^\//, '')}`
}

export function docsHref(lang: Lang, slug: string): string {
  const prefix = lang === 'es' ? 'es/docs' : 'docs'
  return withBase(slug ? `${prefix}/${slug}/` : `${prefix}/`)
}

export function homeHref(lang: Lang): string {
  return withBase(lang === 'es' ? 'es/' : '')
}
