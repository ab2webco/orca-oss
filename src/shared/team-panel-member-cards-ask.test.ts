import { describe, expect, it } from 'vitest'
import type { GameAgent, OrchestratorGameState } from './orchestrator-game-state'
import { teamCardsOf } from './team-panel-member-cards'

const agent = (over: Partial<GameAgent> = {}): GameAgent => ({
  paneKey: 'tab:leaf',
  displayName: 'Toadette ORCA-1216',
  agentType: 'claude',
  state: 'working',
  toolName: null,
  isLeader: false,
  isMember: true,
  ...over
})

const lead = agent({ paneKey: 'lead:leaf', displayName: 'Castle', isLeader: true, isMember: false })

const memberOf = (one: GameAgent, tickets: string[] = []) =>
  teamCardsOf({ agents: [lead, one] } as unknown as OrchestratorGameState, new Set(tickets))
    ?.members[0]

// Why (ORCA-1231): a permission prompt in a member's pane read "Waiting for your answer" and sent the
// person to an empty Inbox, and a real one sat 30 min because it looked like that stale signal.
describe('what a member card says it waits on', () => {
  it('names a pending permission prompt and its tool, not an Inbox question', () => {
    expect(memberOf(agent({ state: 'waiting', toolName: 'Bash' }))).toMatchObject({
      status: 'attention',
      needsYou: true,
      ask: { kind: 'permission', tool: 'Bash' }
    })
  })

  // Why the Inbox: its For you lists a question asked in the pane and answers it there.
  it('sends an AskUserQuestion open in its pane to the Inbox, which answers it', () => {
    expect(memberOf(agent({ state: 'waiting', toolName: 'AskUserQuestion' }))).toMatchObject({
      needsYou: true,
      ask: { kind: 'inbox' }
    })
  })

  it('points to the Inbox only when the Inbox holds its open question', () => {
    expect(memberOf(agent(), ['ORCA-1216'])).toMatchObject({
      needsYou: true,
      ask: { kind: 'inbox' }
    })
    // Why the Inbox first: an answer there is what the member waits on, whatever its pane shows.
    expect(memberOf(agent({ state: 'waiting', toolName: 'Bash' }), ['ORCA-1216'])).toMatchObject({
      ask: { kind: 'inbox' }
    })
  })

  it('asks nothing of a member that waits on nobody', () => {
    expect(memberOf(agent())).toMatchObject({ needsYou: false, ask: null })
    expect(memberOf(agent({ state: 'done', toolName: 'Bash' }))).toMatchObject({ ask: null })
  })

  it('keeps a logged-out member red without calling it a prompt', () => {
    expect(
      memberOf(agent({ state: 'waiting', limit: { resetsAt: null, loggedOut: true } }))
    ).toMatchObject({ condition: 'loggedOut', needsYou: true, ask: null })
  })
})
