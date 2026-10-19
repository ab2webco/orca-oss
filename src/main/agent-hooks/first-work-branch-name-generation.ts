import type { SshGitProvider } from '../providers/ssh-git-provider'
import {
  generateBranchNameFromContext,
  type GenerateCommitMessageParams
} from '../text-generation/commit-message-text-generation'
import { isClaudeUsageLimitFailure } from './claude-usage-limit-failure'
import type { FirstWorkBranchRenameDeps } from './first-work-branch-rename'
import { resolveGenerationTarget } from './first-work-generation-target'

export type BranchNameGenerationRequest = {
  worktreePath: string
  provider: SshGitProvider | null
  params: GenerateCommitMessageParams
  prompt: string
  assistantMessage: string | undefined
  /** Claude account to start on; null = the global selection. */
  initialAccountId: string | null
}

/** Null when no generation environment can be prepared. */
export async function generateBranchNameAcrossClaudeAccounts(
  request: BranchNameGenerationRequest,
  deps: Pick<FirstWorkBranchRenameDeps, 'getAgentEnvResolvers' | 'pickClaudeFallbackAccountId'>
): Promise<Awaited<ReturnType<typeof generateBranchNameFromContext>> | null> {
  const { params } = request
  const triedAccountIds: string[] = []
  let triedGlobal = false
  let accountId = request.initialAccountId
  for (;;) {
    const target = await resolveGenerationTarget(
      request.worktreePath,
      params.agentId,
      request.provider,
      deps,
      accountId
    )
    if (!target) {
      return null
    }
    const generated = await generateBranchNameFromContext(
      { firstPrompt: request.prompt, assistantMessage: request.assistantMessage },
      params,
      target
    )
    if (
      generated.success ||
      generated.canceled ||
      params.agentId !== 'claude' ||
      !isClaudeUsageLimitFailure(generated.error, generated.failureOutput)
    ) {
      return generated
    }
    if (accountId) {
      triedAccountIds.push(accountId)
    } else {
      triedGlobal = true
    }
    const fallbackId = deps.pickClaudeFallbackAccountId({
      excludedAccountIds: triedAccountIds,
      triedGlobal
    })
    if (!fallbackId) {
      return generated
    }
    accountId = fallbackId
  }
}
