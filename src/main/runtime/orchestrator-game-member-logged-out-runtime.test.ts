import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { OrcaRuntimeService } from './orca-runtime'
import { gameFleetOf } from './orchestrator-game-fleet'
import { GAME_MEMBER_STALLED_WORKING_MS } from '../../shared/orchestrator-game-member-limit'

const NOW = 1_793_837_929_728
const LOGGED_OUT_TAIL = ['● Running the tests', '', 'Not logged in · Please run /login', '', '> ']
const WORKING_TAIL = ['● Running the tests', '✻ Thinking…', '', '> ']

// Why (ORCA-923): imac's ORCA-1031 sat at its prompt on "Not logged in" while the lead's Panel read it working.
describe("a host's reading of a member whose turn died on a logout (ORCA-923)", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(NOW)
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  const hostWith = (hookAgoMs: number, tail: string[]) => {
    const hook = {
      paneKey: 'tab:1031',
      state: 'working' as const,
      prompt: '',
      agentType: 'claude',
      connectionId: null,
      receivedAt: NOW - hookAgoMs,
      stateStartedAt: NOW - hookAgoMs - 1000
    }
    const runtime = new OrcaRuntimeService(null, undefined, {
      getAgentStatusSnapshot: () => [hook]
    })
    vi.spyOn(runtime, 'getTerminalPaneKey').mockReturnValue('tab:1031')
    vi.spyOn(
      runtime as unknown as { getTerminalHandleForPaneKey: (paneKey: string) => string | null },
      'getTerminalHandleForPaneKey'
    ).mockReturnValue('term_1031')
    const read = vi.spyOn(runtime, 'readTerminal').mockResolvedValue({ tail } as never)
    return { runtime, read }
  }

  it('relays a member silent past the stall on a /login prompt as waiting, logged out', async () => {
    const { runtime } = hostWith(GAME_MEMBER_STALLED_WORKING_MS, LOGGED_OUT_TAIL)

    expect(await runtime.getFederatedMemberAgent('term_1031')).toMatchObject({
      state: 'waiting',
      limit: { resetsAt: null, loggedOut: true }
    })
  })

  it('keeps a member whose hooks still fire working, without reading its terminal', async () => {
    const { runtime, read } = hostWith(5_000, LOGGED_OUT_TAIL)

    const agent = await runtime.getFederatedMemberAgent('term_1031')

    expect(agent).toMatchObject({ state: 'working' })
    expect(agent).not.toHaveProperty('limit')
    expect(read).not.toHaveBeenCalled()
  })

  it('keeps a long silent turn working when its screen asks for no login', async () => {
    const { runtime } = hostWith(10 * GAME_MEMBER_STALLED_WORKING_MS, WORKING_TAIL)

    const agent = await runtime.getFederatedMemberAgent('term_1031')

    expect(agent).toMatchObject({ state: 'working' })
    expect(agent).not.toHaveProperty('limit')
  })

  it("shows a local member the same way in the lead's fleet", async () => {
    const row = {
      paneKey: 'tab:1031',
      parentPaneKey: 'tab:lead',
      state: 'working' as const,
      agentType: 'claude',
      displayName: 'Wario · ORCA-1031',
      taskTitle: null,
      toolName: null
    }
    const fleetWith = (limit: { resetsAt: null; loggedOut: true } | null) =>
      gameFleetOf({
        agents: [row],
        members: [],
        leaderPaneKey: 'tab:lead',
        teamHandles: null,
        terminalHandleOf: undefined,
        activityOf: () => null,
        readMemberWork: undefined,
        readLinkedStatus: undefined,
        limitOf: async () => limit
      })

    expect((await fleetWith({ resetsAt: null, loggedOut: true }))[0]).toMatchObject({
      state: 'waiting',
      limit: { loggedOut: true }
    })
    expect((await fleetWith(null))[0]).toMatchObject({ state: 'working' })
  })
})
