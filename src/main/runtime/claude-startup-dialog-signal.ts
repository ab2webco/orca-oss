import type { RuntimeTerminalWaitBlockedReason } from '../../shared/runtime-types'

export type ClaudeStartupDialogReason = Extract<
  RuntimeTerminalWaitBlockedReason,
  'claude-folder-trust-prompt' | 'claude-bypass-permissions-prompt'
>

// Why: Claude's closing redraw (`CSI 4A`) drops the option rows from the tail, so match the headings that survive it.
const CLAUDE_FOLDER_TRUST_HEADING = 'accessing workspace:'
const CLAUDE_BYPASS_PERMISSIONS_HEADING = 'running in bypass permissions mode'
const CLAUDE_DIALOG_TAIL_MARKERS = [
  'no, exit',
  'yes, i trust this folder',
  'yes, i accept',
  'enter to confirm'
]

/** Claude startup dialogs in a lowercased wait text, for the shared blocked-signal scan. */
export function findClaudeStartupDialogSignals(
  normalized: string
): { reason: ClaudeStartupDialogReason; index: number }[] {
  const signals: { reason: ClaudeStartupDialogReason; index: number }[] = []
  // Why: the dialogs precede the banner; text after it is the session itself, e.g. a member reading this file.
  if (findClaudeBannerIndex(normalized) !== null) {
    return signals
  }
  const trustIndex = normalized.lastIndexOf(CLAUDE_FOLDER_TRUST_HEADING)
  const bypassIndex = normalized.lastIndexOf(CLAUDE_BYPASS_PERMISSIONS_HEADING)
  if (trustIndex !== -1 && normalized.includes('trust', trustIndex)) {
    signals.push({
      reason: 'claude-folder-trust-prompt',
      index: dialogEndIndex(normalized, trustIndex, bypassIndex)
    })
  }
  if (bypassIndex !== -1) {
    signals.push({
      reason: 'claude-bypass-permissions-prompt',
      index: dialogEndIndex(normalized, bypassIndex, trustIndex)
    })
  }
  return signals
}

// Why: the latest candidate wins, so anchor at the dialog's last row to outrank the generic "trust this" match inside it.
function dialogEndIndex(
  normalized: string,
  headingIndex: number,
  otherHeadingIndex: number
): number {
  const segment = normalized.slice(
    headingIndex,
    otherHeadingIndex > headingIndex ? otherHeadingIndex : undefined
  )
  return (
    headingIndex +
    Math.max(0, ...CLAUDE_DIALOG_TAIL_MARKERS.map((marker) => segment.lastIndexOf(marker)))
  )
}

/** Claude's welcome banner prints only once its startup dialogs are answered. */
export function findClaudeBannerIndex(normalized: string): number | null {
  const index = Math.max(
    normalized.lastIndexOf('claude code v'),
    normalized.lastIndexOf('welcome to claude code')
  )
  return index === -1 ? null : index
}

const CLAUDE_STARTUP_DIALOG_NEXT_STEPS: Record<ClaudeStartupDialogReason, string> = {
  'claude-folder-trust-prompt':
    'Claude Code is asking whether to trust this folder. Run claude once in that folder on this host, accept the trust prompt, then launch again',
  'claude-bypass-permissions-prompt':
    "Claude Code is asking to accept Bypass Permissions mode for this account's config. Run claude --dangerously-skip-permissions once on this host with that account, choose 'Yes, I accept', then launch again"
}

/** The refusal a launch reports when the agent stopped on a startup prompt; Claude's dialogs carry their next step. */
export function describeAgentStartupBlocked(reason: RuntimeTerminalWaitBlockedReason): string {
  const nextStep = (CLAUDE_STARTUP_DIALOG_NEXT_STEPS as Partial<Record<string, string>>)[reason]
  return nextStep
    ? `Agent startup blocked: ${reason}. ${nextStep}.`
    : `Agent startup blocked: ${reason}`
}
