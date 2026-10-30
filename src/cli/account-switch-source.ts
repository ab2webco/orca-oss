import type { ClaudeTerminalAccountOwnership } from '../shared/managed-account-types'
import { UNKNOWN_TERMINAL_ACCOUNT_REASONS } from './account-format'

/**
 * Why a `source-unknown` switch was refused, from what the pane really runs on, and how to move
 * it anyway. Only an account pinned to the pane can be switched in place (ORCA-894).
 */
export function describeUnswitchableSource(
  ownership: ClaudeTerminalAccountOwnership | null,
  target: string
): string {
  const why =
    ownership?.state === 'none'
      ? "This terminal runs on the login in Orca Lab's shared runtime, not on a managed account, so there is no account to switch it from"
      : ownership?.state === 'account' && !ownership.pinned
        ? `This terminal runs on ${ownership.email ?? ownership.accountId} as Orca Lab's shared runtime login, which other terminals share, not as an account pinned to it; only a pinned account is switched in place`
        : ownership?.state === 'unknown'
          ? `Orca does not know which managed Claude account owns this terminal: ${UNKNOWN_TERMINAL_ACCOUNT_REASONS[ownership.reason] ?? ownership.reason}`
          : 'Orca does not know which managed Claude account owns this terminal'
  return `${why}. Relaunch the agent on ${target} instead, in a new conversation: a game member with \`orca game stop <ticket>\`, \`orca game resume-members <ticket> --discard\` and \`orca game launch <ticket> --account ${target}\`, which reuses its worktree; any other with \`orca terminal create --agent claude --claude-account ${target}\`.`
}
