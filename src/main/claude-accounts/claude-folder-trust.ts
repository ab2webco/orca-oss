import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { getLinkedWorktreeMainRepoRoot } from '../git/repo'

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
    const project = projects[folderPath]
    return isRecord(project) && project.hasTrustDialogAccepted === true
  })
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
