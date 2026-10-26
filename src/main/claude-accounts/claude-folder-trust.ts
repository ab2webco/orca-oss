import { randomUUID } from 'node:crypto'
import { mkdir, readFile, realpath, rename, rm, stat, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { getLinkedWorktreeMainRepoRoot } from '../git/repo'

// Why: Claude's own default project entry (2.1.310); a bare `{ hasTrustDialogAccepted }` entry leaves fields it reads undefined.
const DEFAULT_CLAUDE_PROJECT_CONFIG = {
  allowedTools: [],
  mcpContextUris: [],
  mcpServers: {},
  enabledMcpjsonServers: [],
  disabledMcpjsonServers: [],
  hasClaudeMdExternalIncludesApproved: false,
  hasClaudeMdExternalIncludesWarningShown: false
}

/** The config file Claude reads at launch: `<CLAUDE_CONFIG_DIR>/.claude.json`, else `~/.claude.json`. */
export function claudeConfigFilePathOf(
  env: Readonly<Record<string, string | undefined>>,
  homeDir: string = homedir()
): string {
  const configDir = env.CLAUDE_CONFIG_DIR?.trim()
  return configDir ? join(configDir, '.claude.json') : join(homeDir, '.claude.json')
}

/** The folder itself, plus its main checkout when it is a linked worktree: Claude trusts worktrees through the main checkout. */
export function claudeFolderTrustPathsOf(folderPath: string): string[] {
  const mainCheckout = getLinkedWorktreeMainRepoRoot(folderPath)
  return mainCheckout && mainCheckout !== folderPath ? [folderPath, mainCheckout] : [folderPath]
}

export async function isClaudeFolderTrusted(args: {
  configFilePath: string
  folderPaths: readonly string[]
}): Promise<boolean> {
  let config: unknown
  try {
    config = JSON.parse(await readFile(args.configFilePath, 'utf8'))
  } catch {
    return false
  }
  if (!isRecord(config) || !isRecord(config.projects)) {
    return false
  }
  const projects = config.projects
  return args.folderPaths.some((folderPath) => {
    const project = projects[claudeProjectKeyOf(folderPath)]
    return isRecord(project) && project.hasTrustDialogAccepted === true
  })
}

/** Claude keys `projects` by the folder with forward slashes on Windows. */
export function claudeProjectKeyOf(
  folderPath: string,
  platform: NodeJS.Platform = process.platform
): string {
  return platform === 'win32' ? folderPath.replaceAll('\\', '/') : folderPath
}

/** The config with the trust dialog accepted for every key; null when it is not a JSON object Orca may rewrite. */
export function withClaudeFolderTrust(
  content: string,
  projectKeys: readonly string[]
): string | null {
  let config: unknown = {}
  if (content.trim()) {
    try {
      config = JSON.parse(content)
    } catch {
      return null
    }
  }
  if (!isRecord(config)) {
    return null
  }
  const projects = isRecord(config.projects) ? { ...config.projects } : {}
  let changed = false
  for (const key of projectKeys) {
    const project = projects[key]
    if (isRecord(project) && project.hasTrustDialogAccepted === true) {
      continue
    }
    projects[key] = isRecord(project)
      ? { ...project, hasTrustDialogAccepted: true }
      : { ...DEFAULT_CLAUDE_PROJECT_CONFIG, hasTrustDialogAccepted: true }
    changed = true
  }
  return changed ? `${JSON.stringify({ ...config, projects }, null, 2)}\n` : content
}

/** Pre-accepts Claude's folder trust dialog for an Orca workspace in the config file that launch will read. */
export async function markClaudeFolderTrusted(args: {
  configFilePath: string
  folderPath: string
}): Promise<void> {
  // Why: Claude compares against its realpath'd cwd; an Orca path under a symlinked parent would miss.
  const resolved = await realpath(args.folderPath).catch(() => args.folderPath)
  const keys = [...new Set([args.folderPath, resolved].map((path) => claudeProjectKeyOf(path)))]
  // Why: a running Claude rewrites this file too; re-read before publishing so its save is not clobbered.
  for (let attempt = 0; attempt < 3; attempt++) {
    const existing = await readConfigText(args.configFilePath)
    const next = withClaudeFolderTrust(existing ?? '', keys)
    if (next === null || next === existing) {
      return
    }
    const mode = await stat(args.configFilePath).then(
      (info) => info.mode & 0o777,
      () => 0o600
    )
    await mkdir(dirname(args.configFilePath), { recursive: true })
    const tmpPath = `${args.configFilePath}.${process.pid}.${randomUUID()}.tmp`
    try {
      await writeFile(tmpPath, next, { encoding: 'utf8', mode })
      if ((await readConfigText(args.configFilePath)) === existing) {
        await rename(tmpPath, args.configFilePath)
        return
      }
    } finally {
      await rm(tmpPath, { force: true })
    }
  }
}

async function readConfigText(configFilePath: string): Promise<string | null> {
  try {
    return await readFile(configFilePath, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return null
    }
    throw error
  }
}

/** Dispatched workers and game members paste a brief right after launch; a trust prompt would swallow it. */
export function claudeLaunchRequiresFolderTrust(args: {
  launchAgent?: string
  orchestrationWorker?: boolean
  orchestrationGameMember?: boolean
}): boolean {
  return (
    args.launchAgent === 'claude' &&
    (args.orchestrationWorker === true || args.orchestrationGameMember === true)
  )
}

export function claudeFolderTrustRequiredMessage(
  folderPath: string,
  configFilePath: string
): string {
  return `Claude Code has not accepted the folder trust for ${folderPath} in ${configFilePath}. Open that folder in Claude Code, accept the trust prompt, then launch again.`
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
