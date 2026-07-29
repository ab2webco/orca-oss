import type {
  AiVaultClaudeResumeUniverse,
  AiVaultPrepareSessionResumeArgs,
  AiVaultSessionResumePreparation
} from '../../shared/ai-vault-resume-preparation'
import { resolveClaudeTranscriptUniverse } from '../../shared/claude-transcript-universe'
import { LOCAL_EXECUTION_HOST_ID } from '../../shared/execution-host'

/**
 * Resolves which Claude universe a resume must launch against, or undefined
 * when the transcript gives no verdict this process may act on.
 *
 * Why the host guard: a transcript path is only self-describing on the host
 * that owns the file — an SSH or runtime path that merely looks like a local
 * vault must never map onto this process's managed accounts.
 */
export function resolveClaudeResumeUniverse(
  args: Pick<AiVaultPrepareSessionResumeArgs, 'agent' | 'filePath' | 'executionHostId'>,
  options: { hasClaudeManagedAccount: (accountId: string) => boolean }
): AiVaultClaudeResumeUniverse | undefined {
  if (args.agent !== 'claude' || args.executionHostId !== LOCAL_EXECUTION_HOST_ID) {
    return undefined
  }
  const universe = resolveClaudeTranscriptUniverse(args.filePath)
  if (universe.kind === 'managed-account') {
    return options.hasClaudeManagedAccount(universe.accountId)
      ? universe
      : { kind: 'missing-account', accountId: universe.accountId }
  }
  // Why: `unknown` yields no verdict — the launch keeps the worktree's own pin
  // rather than redirecting on a guess.
  return universe.kind === 'shared-home' ? universe : undefined
}

/** Layers the Claude universe verdict onto an existing preparation. */
export function withClaudeResumeUniverse(
  prepare: AiVaultSessionResumePreparation,
  options: { hasClaudeManagedAccount: (accountId: string) => boolean }
): AiVaultSessionResumePreparation {
  return async (args) => {
    const result = await prepare(args)
    const claudeUniverse = resolveClaudeResumeUniverse(args, options)
    return claudeUniverse ? { ...result, claudeUniverse } : result
  }
}
