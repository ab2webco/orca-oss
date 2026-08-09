import { detectAgentStatusFromTitle } from './agent-title-status'
import { extractAllOscTitles } from './osc-title-extraction'
import { extractOscTitleScanTail } from './osc-title-scan-tail'

/**
 * TURN ACCEPTANCE, NOT CONTENT INTEGRITY (ORCA-191).
 *
 * What this proves: after the submit CR, the agent reacted the way it reacts to
 * a new turn — it repainted its title as working, or it printed its own
 * interrupt affordance. That is strictly more than `sendTerminalAgentPrompt`'s
 * `accepted: true`, which only means the bytes reached the PTY writer.
 *
 * What this does NOT prove: that the composer held the exact bytes we sent.
 * Codex collapses a long paste into `[Pasted Content N chars]`, so the payload
 * is absent from the screen and no screen heuristic can check it — and a
 * matching placeholder would still only prove occupancy and a character count,
 * not content or non-interleaving. Exact receipt needs a protocol-level
 * acknowledgement (nonce or hash) from the agent integration. Until one exists,
 * a negative result here is a warning, never a reason to resend: a retry that
 * cannot confirm delivery converges on an interleaved, corrupted composer.
 */
export type AgentTurnAcceptanceEvidence = 'working-title' | 'interrupt-affordance'

// Why: both mainstream agent TUIs print their interrupt affordance only once a
// turn is running, so it is the agent's own reaction rather than an echo of the
// payload. Kept narrow — a phrase that also appears in help text would report
// acceptance for a turn that never started.
const INTERRUPT_AFFORDANCES = ['esc to interrupt', 'esc to cancel'] as const

// eslint-disable-next-line no-control-regex -- strips CSI/OSC so a styled banner still matches
const ANSI_SEQUENCE_RE = /\x1b(?:\][^\x07\x1b]*(?:\x07|\x1b\\)?|\[[0-9;?]*[ -/]*[@-~]|[@-Z\\-_])/g

// Why: an affordance repainted across two chunks must still match; the longest
// phrase is 16 chars, so 256 leaves room for the escape runs a redraw
// interleaves into it without retaining scrollback.
const RECENT_TEXT_LIMIT = 256

export type AgentTurnAcceptanceScanResult = {
  accepted: boolean
  evidence: AgentTurnAcceptanceEvidence | null
}

/**
 * Pure, incremental scanner over post-submit PTY bytes. The caller must
 * subscribe BEFORE the write and start feeding only after the write resolves:
 * causality comes from which chunks are fed, not from comparing timestamps.
 */
export function createAgentTurnAcceptanceScanner(): {
  observe: (data: string) => AgentTurnAcceptanceScanResult
} {
  let oscScanTail = ''
  let recentText = ''

  return {
    observe(data: string): AgentTurnAcceptanceScanResult {
      const oscWindow = oscScanTail + data
      oscScanTail = extractOscTitleScanTail(oscWindow)
      for (const title of extractAllOscTitles(oscWindow)) {
        if (detectAgentStatusFromTitle(title) === 'working') {
          return { accepted: true, evidence: 'working-title' }
        }
      }
      const text = (recentText + data.replace(ANSI_SEQUENCE_RE, '')).toLowerCase()
      recentText = text.slice(-RECENT_TEXT_LIMIT)
      for (const affordance of INTERRUPT_AFFORDANCES) {
        if (text.includes(affordance)) {
          return { accepted: true, evidence: 'interrupt-affordance' }
        }
      }
      return { accepted: false, evidence: null }
    }
  }
}
