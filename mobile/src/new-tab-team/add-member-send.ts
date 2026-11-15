import { addMemberPromptOf } from '../../../src/shared/team-add-member-prompt'
import {
  createLeadPromptSender,
  type LeadPromptOutcome
} from '../../../src/shared/team-lead-prompt-sender'
import type { TeamTodoTicket } from '../../../src/shared/team-panel-model-types'
import { readMobileReviewTerminalSendAccepted } from '../session/mobile-diff-review-rpc'
import type { RpcClient } from '../transport/rpc-client'

export type AddMemberChoice = {
  ticket: TeamTodoTicket
  accountId: string | null
  on: string | null
}

/** Sends the lead the desktop's Add member turn, with the desktop's 3 s guard per ticket. */
export function createAddMemberSender(
  now: () => number
): (client: RpcClient, args: AddMemberChoice & { terminal: string }) => Promise<LeadPromptOutcome> {
  const press = createLeadPromptSender(now)
  return (client, { terminal, ticket, accountId, on }) =>
    press(`add-member:${ticket.identifier}`, async () => {
      // Why no agentPrompt: the host refuses it from a phone; Claude reads the bare \n as a newline.
      const response = await client.sendRequest('terminal.send', {
        terminal,
        text: addMemberPromptOf(ticket, accountId, on),
        enter: true
      })
      return response.ok && readMobileReviewTerminalSendAccepted(response.result)
    })
}
