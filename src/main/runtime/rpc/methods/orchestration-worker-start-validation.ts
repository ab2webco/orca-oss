import { isTuiAgent } from '../../../../shared/tui-agent-config'
import { OrchestrationError } from '../../orchestration/orchestration-error'
import type { WorkerStartInput } from './orchestration-worker-start-schema'

/** Placement and flag contract for a locally-composed worker start. Pure
 *  params checks only; runtime-dependent validation stays with the handler. */
export function assertComposedWorkerStartParams(
  params: WorkerStartInput,
  createsWorktree: boolean
): void {
  if (params.terminal && params.agent) {
    throw new OrchestrationError(
      'invalid_argument',
      '--terminal reuses an existing agent and cannot combine with --agent.'
    )
  }
  if (createsWorktree && params.terminal) {
    throw new OrchestrationError(
      'invalid_argument',
      '--terminal cannot combine with new-worktree creation.'
    )
  }
  if (createsWorktree && !params.name) {
    throw new OrchestrationError('invalid_argument', 'New worktrees require --name.')
  }
  if (!createsWorktree && (params.name || params.repo || params.baseBranch || params.setup)) {
    throw new OrchestrationError(
      'invalid_argument',
      'Creation and setup options apply only to new-child or new-top-level worktrees.'
    )
  }
  if (params.terminal && (params.claudeAccountId || params.codexAccountId)) {
    throw new OrchestrationError(
      'invalid_argument',
      '--claude-account and --codex-account apply only to the agent terminal worker-start creates; --terminal reuses an existing agent.'
    )
  }
  if (!params.terminal && (!params.agent || !isTuiAgent(params.agent))) {
    throw new OrchestrationError(
      'agent_unconfigured',
      'A configured --agent is required when worker-start creates a terminal.'
    )
  }
}
