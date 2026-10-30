import { afterEach, describe, expect, it, vi } from 'vitest'
import { OrcaRuntimeService } from './orca-runtime'
import { OrchestrationDb } from './orchestration/db'
import { OrchestrationError } from './orchestration/orchestration-error'
import type { GameAgent } from '../../shared/orchestrator-game-state'

const LEAD_PANE = 'tab-1:11111111-1111-4111-8111-111111111111'

const leadRow = {
  paneKey: LEAD_PANE,
  parentPaneKey: null,
  state: 'working' as const,
  agentType: 'claude',
  prompt: '',
  taskTitle: null,
  displayName: null,
  lastAssistantMessage: null,
  toolName: null,
  toolInput: null,
  interrupted: false,
  stateStartedAt: 0,
  updatedAt: 0
}

describe("a lead's game state with a member on a paired host (ORCA-824)", () => {
  const databases: OrchestrationDb[] = []

  afterEach(() => {
    for (const database of databases) {
      database.close()
    }
    databases.length = 0
  })

  function leadWithRemoteMember(): { runtime: OrcaRuntimeService; dispatchId: string } {
    const runtime = new OrcaRuntimeService(null)
    vi.spyOn(runtime, 'getWorktreePs').mockResolvedValue({
      worktrees: [{ worktreeId: 'wt-lead', branch: 'main', displayName: 'lead', agents: [leadRow] }]
    } as never)
    const db = new OrchestrationDb(':memory:')
    databases.push(db)
    runtime.setOrchestrationDb(db)
    const run = db.createRun({
      objective: 'lead',
      coordinatorHandle: 'term_lead',
      coordinatorPaneKey: LEAD_PANE
    })
    const task = db.createTask({ spec: 'gate', taskTitle: 'ORCA-805 gate', runId: run.id })
    const started = db.createStartingWorkerDispatch({
      taskId: task.id,
      startOptions: { on: 'env_imac', serverName: 'imac' },
      federation: {
        environmentId: 'env_imac',
        environmentName: 'imac',
        peerFingerprint: 'fp_imac',
        protocolVersion: 1
      }
    })
    db.updateFederatedDispatchResources({
      dispatchId: started.dispatch.id,
      remoteRuntimeEpoch: 'epoch_imac',
      worktreeId: 'repo::/home/me/orca-805',
      terminalHandle: 'term_on_imac'
    })
    return { runtime, dispatchId: started.dispatch.id }
  }

  it('lists the remote member with its host and the state its host reports', async () => {
    const { runtime, dispatchId } = leadWithRemoteMember()
    const show = vi.spyOn(runtime, 'callOrchestrationWorkerServer').mockResolvedValue({
      terminal: { branch: 'fabolivark/orca-805', title: '✳ Claude Code', liveness: 'running' }
    })

    const state = await runtime.getOrchestratorGameState({ paneKey: LEAD_PANE })

    expect(show).toHaveBeenCalledWith(
      'env_imac',
      'orchestration.federationShow',
      { dispatchId },
      3_000
    )
    expect(state.agents.filter((agent) => agent.isMember)).toEqual([
      expect.objectContaining({
        paneKey: `remote:${dispatchId}`,
        displayName: 'ORCA-805 gate',
        state: 'idle',
        terminalHandle: 'term_on_imac',
        remote: { host: 'imac', stateKnown: true },
        worktree: expect.objectContaining({ branch: 'fabolivark/orca-805' })
      })
    ])
  })

  it("shows a settled member the host's hooks still see working (ORCA-837)", async () => {
    const { runtime, dispatchId } = leadWithRemoteMember()
    const sqlite = (
      runtime.getOrchestrationDb() as unknown as {
        db: { prepare: (sql: string) => { run: () => void } }
      }
    ).db
    sqlite
      .prepare(
        `UPDATE dispatch_contexts SET status = 'completed', completed_at = '2999-01-01'
         WHERE id = '${dispatchId}'`
      )
      .run()
    vi.spyOn(runtime, 'callOrchestrationWorkerServer').mockResolvedValue({
      terminal: { branch: 'fabolivark/orca-817', title: '✳ Claude Code', liveness: 'running' },
      agent: { state: 'working', agentType: 'claude', updatedAt: 1_000, unknownField: 1 }
    })

    const state = await runtime.getOrchestratorGameState({ paneKey: LEAD_PANE })

    expect(state.agents.find((agent) => agent.isMember)).toMatchObject({
      state: 'working',
      agentType: 'claude',
      lastActivityAt: new Date(1_000).toISOString()
    })
  })

  it('keeps the member when its host is offline, state unknown', async () => {
    const { runtime, dispatchId } = leadWithRemoteMember()
    vi.spyOn(runtime, 'callOrchestrationWorkerServer').mockRejectedValue(
      new Error('environment_unavailable')
    )

    const state = await runtime.getOrchestratorGameState({ paneKey: LEAD_PANE })

    expect(state.agents.filter((agent) => agent.isMember)).toEqual([
      expect.objectContaining({
        paneKey: `remote:${dispatchId}`,
        remote: { host: 'imac', stateKnown: false }
      })
    ])
  })

  // Why: the host answers with no terminal once the member's closed; that is not an offline host (ORCA-854).
  it('marks the member gone, not its host silent, when the host answers without its terminal', async () => {
    const { runtime } = leadWithRemoteMember()
    const show = vi.spyOn(runtime, 'callOrchestrationWorkerServer')
    show.mockResolvedValueOnce({ terminal: null, observation: { status: 'missing' } })
    const closed = await runtime.getOrchestratorGameState({ paneKey: LEAD_PANE })
    show.mockRejectedValueOnce(
      new OrchestrationError('dispatch_not_found', 'Remote Dispatch was not found.')
    )
    const forgotten = await runtime.getOrchestratorGameState({ paneKey: LEAD_PANE })

    for (const state of [closed, forgotten]) {
      expect(state.agents.find((agent) => agent.isMember)?.remote).toEqual({
        host: 'imac',
        stateKnown: true,
        gone: true
      })
    }
  })

  it('lists a member an earlier lead left running on the host, flagged with its ticket done (ORCA-793)', async () => {
    const { runtime } = leadWithRemoteMember()
    const earlierPane = 'tab-0:33333333-3333-4333-8333-333333333333'
    // Why: an earlier lead's members are listed only within the lead's own project (ORCA-848).
    vi.spyOn(
      runtime as unknown as { getResolvedWorktreeMap: () => Promise<Map<string, unknown>> },
      'getResolvedWorktreeMap'
    ).mockResolvedValue(new Map([['wt-lead', { id: 'wt-lead', repoId: 'repo-orca' }]]))
    vi.spyOn(runtime, 'getTerminalWorktreeIdForPaneKey').mockImplementation((paneKey) =>
      paneKey === LEAD_PANE || paneKey === earlierPane ? 'wt-lead' : null
    )
    const db = runtime.getOrchestrationDb()
    const earlier = db.createRun({
      objective: 'earlier lead',
      coordinatorHandle: 'term_gone',
      coordinatorPaneKey: earlierPane
    })
    const task = db.createTask({ spec: 'release', taskTitle: 'ORCA-829 check', runId: earlier.id })
    const started = db.createStartingWorkerDispatch({
      taskId: task.id,
      startOptions: { on: 'env_imac', serverName: 'imac' },
      federation: {
        environmentId: 'env_imac',
        environmentName: 'imac',
        peerFingerprint: 'fp_imac',
        protocolVersion: 1
      }
    })
    db.updateFederatedDispatchResources({
      dispatchId: started.dispatch.id,
      remoteRuntimeEpoch: 'epoch_imac',
      worktreeId: 'repo::/home/me/orca-829',
      terminalHandle: 'term_5c58ff4d'
    })
    const sqlite = (db as unknown as { db: { prepare: (sql: string) => { run: () => void } } }).db
    sqlite.prepare(`UPDATE tasks SET status = 'completed' WHERE id = '${task.id}'`).run()
    sqlite
      .prepare(
        `UPDATE dispatch_contexts SET status = 'completed', completed_at = '2026-10-20 10:00:00'
         WHERE id = '${started.dispatch.id}'`
      )
      .run()
    vi.spyOn(runtime, 'callOrchestrationWorkerServer').mockResolvedValue({
      terminal: { branch: 'fabolivark/orca-829', title: '✳ Claude Code', liveness: 'running' }
    })

    const state = await runtime.getOrchestratorGameState({ paneKey: LEAD_PANE })

    expect(state.agents.filter((agent) => agent.isMember)).toEqual([
      expect.objectContaining({ displayName: 'ORCA-805 gate' }),
      expect.objectContaining({
        paneKey: `remote:${started.dispatch.id}`,
        state: 'done',
        terminalHandle: 'term_5c58ff4d',
        remote: { host: 'imac', stateKnown: true, earlierLead: true, ticketDone: true }
      })
    ])
  })
})

describe("a lead's earlier-lead remote members stay in its project (ORCA-848)", () => {
  const databases: OrchestrationDb[] = []
  const ORCA_PANE = 'tab-2:22222222-2222-4222-8222-222222222222'
  const CINECO_PANE = 'tab-3:33333333-3333-4333-8333-333333333333'

  afterEach(() => {
    for (const database of databases) {
      database.close()
    }
    databases.length = 0
  })

  // Why the casts: these lookups are private, and real ones need live panes and a worktree scan.
  function leadInOrca(
    livePanes: readonly string[] = [],
    before: (db: OrchestrationDb) => void = () => undefined
  ): {
    runtime: OrcaRuntimeService
    db: OrchestrationDb
  } {
    const runtime = new OrcaRuntimeService(null)
    vi.spyOn(runtime, 'getWorktreePs').mockResolvedValue({
      worktrees: [{ worktreeId: 'wt-lead', branch: 'main', displayName: 'lead', agents: [leadRow] }]
    } as never)
    const internals = runtime as unknown as {
      getResolvedWorktreeMap: () => Promise<Map<string, unknown>>
      getPtyRecordForPaneKey: (paneKey: string) => { connected: boolean } | null
    }
    vi.spyOn(internals, 'getResolvedWorktreeMap').mockResolvedValue(
      new Map([
        ['wt-lead', { id: 'wt-lead', repoId: 'repo-orca' }],
        ['wt-orca-old', { id: 'wt-orca-old', repoId: 'repo-orca' }],
        ['wt-cineco', { id: 'wt-cineco', repoId: 'repo-cineco' }]
      ])
    )
    const worktreeOfPane: Record<string, string> = {
      [LEAD_PANE]: 'wt-lead',
      [ORCA_PANE]: 'wt-orca-old',
      [CINECO_PANE]: 'wt-cineco'
    }
    vi.spyOn(runtime, 'getTerminalWorktreeIdForPaneKey').mockImplementation(
      (paneKey) => worktreeOfPane[paneKey] ?? null
    )
    vi.spyOn(internals, 'getPtyRecordForPaneKey').mockImplementation((paneKey) =>
      livePanes.includes(paneKey) ? { connected: true } : null
    )
    const db = new OrchestrationDb(':memory:')
    databases.push(db)
    runtime.setOrchestrationDb(db)
    before(db)
    db.createRun({
      objective: 'lead',
      coordinatorHandle: 'term_lead',
      coordinatorPaneKey: LEAD_PANE
    })
    vi.spyOn(runtime, 'callOrchestrationWorkerServer').mockResolvedValue({
      terminal: { branch: 'fabolivark/member', title: '✳ Claude Code', liveness: 'running' }
    })
    return { runtime, db }
  }

  function remoteMemberOf(
    db: OrchestrationDb,
    runId: string,
    title: string,
    createdByPaneKey?: string
  ): string {
    const task = db.createTask({ spec: title, taskTitle: title, runId, createdByPaneKey })
    const started = db.createStartingWorkerDispatch({
      taskId: task.id,
      startOptions: { on: 'env_imac', serverName: 'imac' },
      federation: {
        environmentId: 'env_imac',
        environmentName: 'imac',
        peerFingerprint: 'fp_imac',
        protocolVersion: 1
      }
    })
    db.updateFederatedDispatchResources({
      dispatchId: started.dispatch.id,
      remoteRuntimeEpoch: 'epoch_imac',
      worktreeId: `repo::/home/me/${title.toLowerCase()}`,
      terminalHandle: `term_${title}`
    })
    return started.dispatch.id
  }

  const remoteNames = (agents: readonly GameAgent[]) =>
    agents.filter((agent) => agent.isMember).map((agent) => agent.displayName)

  it("leaves out a member of another project's Run whose lead is gone", async () => {
    const { runtime, db } = leadInOrca()
    const cineco = db.createRun({
      objective: 'cineco lead',
      coordinatorHandle: 'term_cineco_gone',
      coordinatorPaneKey: CINECO_PANE
    })
    remoteMemberOf(db, cineco.id, 'CINE-12')

    const state = await runtime.getOrchestratorGameState({ paneKey: LEAD_PANE })

    expect(remoteNames(state.agents)).toEqual([])
  })

  it('treats a Run whose handle is stale but whose lead pane still runs as live (ORCA-835)', async () => {
    const { runtime, db } = leadInOrca([ORCA_PANE])
    const fenced = db.createRun({
      objective: 'fenced lead',
      coordinatorHandle: 'term_before_restart',
      coordinatorPaneKey: ORCA_PANE
    })
    remoteMemberOf(db, fenced.id, 'ORCA-844')

    const state = await runtime.getOrchestratorGameState({ paneKey: LEAD_PANE })

    expect(remoteNames(state.agents)).toEqual([])
  })

  it("still lists this project's earlier lead's member once the lead is gone", async () => {
    const { runtime, db } = leadInOrca()
    const earlier = db.createRun({
      objective: 'earlier lead',
      coordinatorHandle: 'term_before_restart',
      coordinatorPaneKey: ORCA_PANE
    })
    remoteMemberOf(db, earlier.id, 'ORCA-829')

    const state = await runtime.getOrchestratorGameState({ paneKey: LEAD_PANE })

    expect(remoteNames(state.agents)).toEqual(['ORCA-829'])
  })

  it('places a Run a newer lead unbound by the pane that created its member', async () => {
    const { runtime, db } = leadInOrca([], (home) => {
      const unbound = home.createRun({
        objective: 'earlier lead in this pane',
        coordinatorHandle: 'term_earlier',
        coordinatorPaneKey: LEAD_PANE
      })
      remoteMemberOf(home, unbound.id, 'ORCA-826', LEAD_PANE)
    })
    const cineco = db.createRun({
      objective: 'cineco lead',
      coordinatorHandle: 'term_cineco_old',
      coordinatorPaneKey: CINECO_PANE
    })
    remoteMemberOf(db, cineco.id, 'CINE-12', CINECO_PANE)
    db.createRun({
      objective: 'newer cineco lead',
      coordinatorHandle: 'term_cineco_new',
      coordinatorPaneKey: CINECO_PANE
    })

    const state = await runtime.getOrchestratorGameState({ paneKey: LEAD_PANE })

    expect(remoteNames(state.agents)).toEqual(['ORCA-826'])
  })
})

describe("a host's reading of a federated member's agent (ORCA-837)", () => {
  const hook = (state: 'working' | 'done') => ({
    paneKey: 'tab:817',
    state,
    prompt: '',
    agentType: 'claude',
    connectionId: null,
    receivedAt: 42,
    stateStartedAt: 40
  })

  it("reads the terminal's pane from the hook snapshot and adds a usage limit when stopped", async () => {
    let rows = [hook('working')]
    const runtime = new OrcaRuntimeService(null, undefined, { getAgentStatusSnapshot: () => rows })
    vi.spyOn(runtime, 'getTerminalPaneKey').mockReturnValue('tab:817')
    const limitFor = vi
      .spyOn(
        runtime as unknown as {
          gameMemberLimitFor: (member: { state: string }) => Promise<unknown>
        },
        'gameMemberLimitFor'
      )
      // Why: the real reading never limits a working member.
      .mockImplementation(async ({ state }) => (state === 'working' ? null : { resetsAt: 9 }))

    expect(await runtime.getFederatedMemberAgent('term_817')).toEqual({
      state: 'working',
      agentType: 'claude',
      updatedAt: 42
    })
    rows = [hook('done')]
    expect(await runtime.getFederatedMemberAgent('term_817')).toEqual({
      state: 'done',
      agentType: 'claude',
      updatedAt: 42,
      limit: { resetsAt: 9 }
    })
    expect(limitFor).toHaveBeenCalledWith(
      expect.objectContaining({ paneKey: 'tab:817', state: 'done', account: null })
    )
  })

  it('relays the email of the account its pane runs on, and weighs its limit by it (ORCA-798)', async () => {
    const runtime = new OrcaRuntimeService(null, undefined, {
      getAgentStatusSnapshot: () => [hook('done')]
    })
    vi.spyOn(runtime, 'getTerminalPaneKey').mockReturnValue('tab:817')
    const account = { provider: 'claude', id: 'imac-ana', email: 'ana@koombea.com' }
    vi.spyOn(
      runtime as unknown as { gameMemberAccountFor: () => unknown },
      'gameMemberAccountFor'
    ).mockReturnValue(account)
    const limitFor = vi
      .spyOn(
        runtime as unknown as { gameMemberLimitFor: () => Promise<unknown> },
        'gameMemberLimitFor'
      )
      .mockResolvedValue(null)

    const agent = await runtime.getFederatedMemberAgent('term_817')

    expect(agent?.account).toEqual({ provider: 'claude', email: 'ana@koombea.com' })
    expect(JSON.stringify(agent)).not.toContain('imac-ana')
    expect(limitFor).toHaveBeenCalledWith(expect.objectContaining({ account }))
  })
})

describe('the member name pool with a member on a paired host (ORCA-794)', () => {
  it("skips the name a remote member's home task holds", async () => {
    const runtime = new OrcaRuntimeService(null)
    vi.spyOn(runtime, 'getWorktreePs').mockResolvedValue({ worktrees: [] } as never)
    const db = new OrchestrationDb(':memory:')
    runtime.setOrchestrationDb(db)
    const run = db.createRun({
      objective: 'lead',
      coordinatorHandle: 'term_lead',
      coordinatorPaneKey: LEAD_PANE
    })
    const task = db.createTask({ spec: 'gate', taskTitle: 'Arthur · ORCA-805 gate', runId: run.id })
    db.createStartingWorkerDispatch({
      taskId: task.id,
      startOptions: { on: 'env_imac', serverName: 'imac' },
      federation: {
        environmentId: 'env_imac',
        environmentName: 'imac',
        peerFingerprint: 'fp_imac',
        protocolVersion: 1
      }
    })

    const reserved = await runtime.reserveGameMemberName({
      ticket: 'ORCA-806',
      roster: ['Arthur', 'Merlin'],
      locale: 'en',
      taken: []
    })

    expect(reserved).toEqual({ name: 'Merlin' })
    db.close()
  })
})
