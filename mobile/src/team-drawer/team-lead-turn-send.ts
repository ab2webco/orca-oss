import {
  createLeadPromptSender,
  type LeadPromptOutcome
} from '../../../src/shared/team-lead-prompt-sender'
import { readMobileReviewTerminalSendAccepted } from '../session/mobile-diff-review-rpc'
import type { RpcClient } from '../transport/rpc-client'

/** `reason`: the host's or connection's words when a send failed; null when it gave none. */
export type TeamTurnResult = { outcome: LeadPromptOutcome; reason: string | null }

export type TeamLeadTurnSender = (
  client: RpcClient,
  terminal: string,
  key: string,
  prompt: string
) => Promise<TeamTurnResult>

/** Sends the lead a turn through its terminal with the desktop dock's 3 s repeat guard. */
export function createTeamLeadTurnSender(now: () => number): TeamLeadTurnSender {
  const press = createLeadPromptSender(now)
  return async (client, terminal, key, prompt) => {
    let reason: string | null = null
    const outcome = await press(key, async () => {
      // Why no agentPrompt: the host refuses it while the phone drives the lead's terminal.
      const response = await client
        .sendRequest('terminal.send', { terminal, text: prompt, enter: true })
        .catch((error: unknown) => {
          reason = error instanceof Error ? error.message : String(error)
          return null
        })
      if (response && !response.ok) {
        reason = response.error.message
      }
      return response?.ok === true && readMobileReviewTerminalSendAccepted(response.result)
    })
    return { outcome, reason }
  }
}

export const sendTeamLeadTurn = createTeamLeadTurnSender(Date.now)
