import {
  createLeadPromptSender,
  type LeadPromptOutcome
} from '../../../src/shared/team-lead-prompt-sender'
import type { RpcClient } from '../transport/rpc-client'

export type TeamLeadTurnSender = (
  client: RpcClient,
  terminal: string,
  key: string,
  prompt: string
) => Promise<LeadPromptOutcome>

/** Sends the lead a turn through its terminal, as the desktop dock does, with its 3 s repeat guard. */
export function createTeamLeadTurnSender(now: () => number): TeamLeadTurnSender {
  const press = createLeadPromptSender(now)
  return (client, terminal, key, prompt) =>
    press(key, async () => {
      // Why agentPrompt: a raw `text\r` races the agent's composer and can leave the turn unsent (ORCA-437).
      const response = await client.sendRequest('terminal.send', {
        terminal,
        text: prompt,
        enter: true,
        agentPrompt: true
      })
      const send = response.ok
        ? (response.result as { send?: { accepted?: unknown } } | null)?.send
        : null
      return send?.accepted === true
    })
}

export const sendTeamLeadTurn = createTeamLeadTurnSender(Date.now)
