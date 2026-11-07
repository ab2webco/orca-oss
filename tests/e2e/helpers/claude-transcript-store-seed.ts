import { existsSync, mkdirSync, symlinkSync, writeFileSync } from 'node:fs'
import path from 'node:path'

export type ClaudeTranscriptStoreSeed = {
  appUserDataDir: string
  sessionId: string
  content?: string
  /** False lays out the store without the conversation. */
  inStore?: boolean
}

/**
 * Lays out Orca's shared Claude transcript store under the app's userData and links the isolated
 * home's `~/.claude/projects` to it, as Orca does for every universe it launches (ORCA-718).
 */
export function seedClaudeTranscriptStore(
  isolatedHome: string,
  args: ClaudeTranscriptStoreSeed
): { storeDir: string; homeClaudeDir: string } {
  const storeDir = path.join(args.appUserDataDir, 'claude-transcripts', 'projects')
  mkdirSync(path.join(storeDir, '-e2e-repo'), { recursive: true })
  const homeClaudeDir = path.join(isolatedHome, '.claude')
  const homeProjects = path.join(homeClaudeDir, 'projects')
  if (!existsSync(homeProjects)) {
    mkdirSync(homeClaudeDir, { recursive: true })
    // Why a junction on Windows: creating a symlink there needs elevation.
    symlinkSync(storeDir, homeProjects, process.platform === 'win32' ? 'junction' : 'dir')
  }
  if (args.inStore !== false) {
    writeFileSync(
      path.join(storeDir, '-e2e-repo', `${args.sessionId}.jsonl`),
      args.content ?? `${JSON.stringify({ type: 'summary', sessionId: args.sessionId })}\n`
    )
  }
  return { storeDir, homeClaudeDir }
}
