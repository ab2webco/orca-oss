import {
  createLeadPromptSender,
  type LeadPromptOutcome
} from '../../../src/shared/team-lead-prompt-sender'
import { readMobileReviewTerminalSendAccepted } from '../session/mobile-diff-review-rpc'
import type { RpcClient } from '../transport/rpc-client'

export type TeamLeadTurnSender = (
  client: RpcClient,
  terminal: string,
  key: string,
  prompt: string
) => Promise<LeadPromptOutcome>

/** Sends the lead a turn through its terminal with the desktop dock's 3 s repeat guard. */
export function createTeamLeadTurnSender(now: () => number): TeamLeadTurnSender {
  const press = createLeadPromptSender(now)
  return (client, terminal, key, prompt) =>
    press(key, async () => {
      // Why no agentPrompt: the host refuses it while the phone drives the lead's terminal.
      const response = await client.sendRequest('terminal.send', {
        terminal,
        text: prompt,
        enter: true
      })
      return response.ok && readMobileReviewTerminalSendAccepted(response.result)
    })
}

export const sendTeamLeadTurn = createTeamLeadTurnSender(Date.now)
