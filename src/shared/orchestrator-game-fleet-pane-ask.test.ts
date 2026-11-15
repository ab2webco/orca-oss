import { describe, expect, it } from 'vitest'
import { gameFleetReportOf } from './orchestrator-game-fleet-verbs'
import type { GameAgent } from './orchestrator-game-state'

const member = (over: Partial<GameAgent>): GameAgent => ({
  paneKey: 'p',
  displayName: 'Toadette ORCA-1216',
  agentType: 'claude',
  state: 'waiting',
  toolName: 'Bash',
  isLeader: false,
  isMember: true,
  terminalHandle: 'term_toadette',
  ...over
})

const rowOf = (agent: GameAgent, waiting: { id: string; from: string }[] = []) =>
  gameFleetReportOf({
    agents: [agent],
    inboxes: [{ key: 'lead', waiting } as never]
  }).rows[0]

// Why (ORCA-1231): `game fleet` said "answer it" for a permission prompt the lead cannot answer by mail.
describe("the fleet's NEXT for a member blocked in its own pane", () => {
  it('sends the lead to the pane for a permission prompt, naming the tool', () => {
    expect(rowOf(member({}))).toMatchObject({
      phase: 'needs-you',
      next: 'permission prompt (Bash) in its pane: open term_toadette'
    })
  })

  it('sends the lead to the pane for a question asked there', () => {
    expect(rowOf(member({ toolName: 'AskUserQuestion' }))).toMatchObject({
      phase: 'needs-you',
      next: 'question in its pane: open term_toadette'
    })
  })

  it('keeps the reply for a question the Inbox holds', () => {
    expect(rowOf(member({}), [{ id: 'msg_1', from: 'ORCA-1216' }])).toMatchObject({
      next: 'waiting on you: orchestration reply --id msg_1'
    })
  })
})
