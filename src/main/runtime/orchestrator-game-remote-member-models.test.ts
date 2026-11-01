import { afterEach, describe, expect, it } from 'vitest'
import { OrchestrationDb } from './orchestration/db'
import {
  listRemoteGameMemberSources,
  remoteGameMembersOf,
  type RemoteGameMemberShow,
  type RemoteGameMemberSource
} from './orchestrator-game-remote-members'

const source: RemoteGameMemberSource = {
  dispatchId: 'ctx_933',
  taskTitle: 'ORCA-933',
  hostName: 'm1',
  environmentId: 'env_m1',
  remoteTerminalHandle: 'term_933',
  remoteWorktreeId: 'repo::/home/me/orca-933',
  stage: 'agent_started',
  lastActivityAt: null,
  createdAt: '2026-10-31 13:00:00',
  finished: false,
  ticketDone: false,
  earlierLead: false,
  launch: null
}

const working = (agent: Partial<NonNullable<RemoteGameMemberShow['agent']>> = {}) => ({
  branch: 'fabolivark/orca-933',
  title: null,
  liveness: 'running' as const,
  agent: { state: 'working' as const, agentType: 'claude', updatedAt: 1, ...agent }
})

const memberOf = async (show: RemoteGameMemberShow | null, from = source) =>
  (await remoteGameMembersOf([from], { showOf: async () => show, reviewOf: async () => null }))[0]

describe("a remote member's activity and model on the lead's Panel (ORCA-933)", () => {
  it('shows the tool its host says it runs, and none once its terminal is gone', async () => {
    expect((await memberOf(working({ toolName: 'Bash' })))?.toolName).toBe('Bash')
    expect(
      (await memberOf({ ...working({ toolName: 'Bash' }), liveness: 'gone' }))?.toolName
    ).toBeNull()
  })

  it('shows the Jev report its host holds for a member with Jev', async () => {
    const advisor = {
      model: 'Opus 5.5',
      effort: 'medium',
      pinned: { model: false, effort: false }
    }
    const member = await memberOf(
      working({ advisor, launch: { model: 'Opus 5.5', effort: 'high', source: 'session' } })
    )
    expect(member?.advisor).toEqual(advisor)
    expect(member?.launch).toEqual({ model: 'Opus 5.5', effort: 'high', source: 'session' })
  })

  it("shows the model a Jev-less member's own hooks named, over its launch", async () => {
    const member = await memberOf(
      working({ launch: { model: 'Sonnet 5.5', effort: 'low', source: 'session' } }),
      { ...source, launch: { model: 'Opus 5.5', effort: 'high', source: 'launch' } }
    )
    expect(member).not.toHaveProperty('advisor')
    expect(member?.launch).toEqual({ model: 'Sonnet 5.5', effort: 'low', source: 'session' })
  })

  it('falls back to the launch model the home recorded when the host relays none', async () => {
    const launch = { model: 'Opus 5.5', effort: 'high', source: 'launch' as const }
    expect((await memberOf(working(), { ...source, launch }))?.launch).toEqual(launch)
    // Why: an older host relays no agent at all, and the launch is still the home's own record.
    expect((await memberOf({ ...working(), agent: null }, { ...source, launch }))?.launch).toEqual(
      launch
    )
  })

  describe('the launch the home recorded for a remote dispatch', () => {
    let db: OrchestrationDb | undefined

    afterEach(() => {
      db?.close()
      db = undefined
    })

    it('reads the model and effort the lead chose, labelled as the launch', () => {
      db = new OrchestrationDb(':memory:')
      const run = db.createRun({
        objective: 'lead',
        coordinatorHandle: 'term_lead',
        coordinatorPaneKey: 'tab_lead:11111111-1111-4111-8111-111111111111'
      })
      const start = (title: string, launch: unknown) => {
        const task = db!.createTask({ spec: title, taskTitle: title, runId: run.id })
        db!.createStartingWorkerDispatch({
          taskId: task.id,
          startOptions: { on: 'env_m1', serverName: 'm1', launch },
          federation: {
            environmentId: 'env_m1',
            environmentName: 'm1',
            peerFingerprint: 'fp_m1',
            protocolVersion: 1
          }
        })
      }
      start('ORCA-933', { effective: { model: 'claude-opus-5-5', effort: 'high' } })
      start('ORCA-934', undefined)

      expect(listRemoteGameMemberSources(db, run.id).map((one) => one.launch)).toEqual([
        { model: 'Opus 5.5', effort: 'high', source: 'launch' },
        null
      ])
    })
  })
})
