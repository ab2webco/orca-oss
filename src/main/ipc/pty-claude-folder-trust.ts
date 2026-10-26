import {
  claudeConfigFilePathOf,
  claudeFolderTrustPathsOf,
  claudeFolderTrustRequiredMessage,
  isClaudeFolderTrusted,
  markClaudeFolderTrusted
} from '../claude-accounts/claude-folder-trust'
import { markRemoteClaudeFolderTrusted } from '../remote-agent-trust-presets'

/**
 * Trusts the Orca workspace root for the Claude config this launch reads, then,
 * when the launch requires it, refuses a folder Claude would still prompt for
 * (ORCA-776, ORCA-792).
 */
export async function ensureClaudeFolderTrustForSpawn(args: {
  cwd: string | undefined
  workspaceRoot: string | null
  connectionId: string | null | undefined
  env: Record<string, string> | undefined
  requireTrust: boolean
}): Promise<void> {
  if (args.connectionId) {
    // Why: the remote host's Claude reads its own home; the pane env is the only hint of a different config dir.
    const trusted = args.workspaceRoot
      ? await markRemoteClaudeFolderTrusted({
          connectionId: args.connectionId,
          workspacePath: args.workspaceRoot,
          configDir: args.env?.CLAUDE_CONFIG_DIR
        }).catch(() => false)
      : false
    if (args.requireTrust && !trusted) {
      const folder = args.cwd ?? args.workspaceRoot ?? 'this workspace'
      throw new Error(claudeFolderTrustRequiredMessage(folder, 'the remote Claude config'))
    }
    return
  }
  const configFilePath = claudeConfigFilePathOf({ ...process.env, ...args.env })
  if (args.workspaceRoot) {
    try {
      await markClaudeFolderTrusted({ configFilePath, folderPath: args.workspaceRoot })
    } catch {
      // Best-effort: the read-back below refuses when the launch cannot tolerate the prompt.
    }
  }
  if (!args.requireTrust) {
    return
  }
  if (!args.cwd) {
    throw new Error(
      'Claude Code has no folder to launch in, so its folder trust cannot be checked.'
    )
  }
  const trusted = await isClaudeFolderTrusted({
    configFilePath,
    folderPaths: [
      ...claudeFolderTrustPathsOf(args.cwd),
      ...(args.workspaceRoot ? [args.workspaceRoot] : [])
    ]
  })
  if (!trusted) {
    throw new Error(claudeFolderTrustRequiredMessage(args.cwd, configFilePath))
  }
}
