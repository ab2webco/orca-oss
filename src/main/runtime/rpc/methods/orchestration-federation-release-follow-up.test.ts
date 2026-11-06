import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ORCHESTRATION_CONTRACT_VERSION } from '../../../../shared/protocol-version'
import type { RuntimeRpcResponse } from '../../../../shared/runtime-rpc-envelope'
import { OrcaRuntimeService } from '../../orca-runtime'
import { OrchestrationDb } from '../../orchestration/db'
import type { OrchestrationEnvironmentTransport } from '../../orchestration/environment-transport'
import { listRemoteGameMemberSources } from '../../orchestrator-game-remote-members'
import { RpcDispatcher } from '../dispatcher'
import { ORCHESTRATION_METHODS } from './orchestration'
import { createFederationWorkerStartRequest as startRequest } from './orchestration-federation-test-request'
import { configureWorkerRuntime } from './orchestration-federation-worker-runtime-mocks'
import { WORKTREE_METHODS } from './worktree'

const WORKTREE = 'repo::windows-worktree'
const TERMINAL = 'term_windows_worker'

// Why: a follow-up reuses its member's terminal and worktree, so releasing it alone closed and
// removed nothing; the first dispatch stayed unreleased and kept the member in the fleet (ORCA-1076).
describe('releasing a remote member that took follow-up work in its worktree', () => {
  let homeDb: OrchestrationDb
  let workerDb: OrchestrationDb
  let homeRuntime: OrcaRuntimeService
  let workerRuntime: OrcaRuntimeService
  let homeDispatcher: RpcDispatcher
  let workerDispatcher: RpcDispatcher
  let remoteMethods: string[]

  beforeEach(() => {
    homeDb = new OrchestrationDb(':memory:')
    workerDb = new OrchestrationDb(':memory:')
    workerRuntime = new OrcaRuntimeService()
    workerRuntime.setOrchestrationDb(workerDb)
    configureWorkerRuntime(workerRuntime)
    vi.spyOn(workerRuntime, 'removeManagedWorktree').mockResolvedValue({} as never)
    vi.spyOn(workerRuntime, 'showManagedTerminalWorkspace').mockResolvedValue({
      id: WORKTREE
    } as never)
    workerDispatcher = new RpcDispatcher({
      runtime: workerRuntime,
      methods: [...ORCHESTRATION_METHODS, ...WORKTREE_METHODS]
    })
    remoteMethods = []
    const transport: OrchestrationEnvironmentTransport = {
      resolve: () => ({
        environmentId: 'environment_windows',
        name: 'windows',
        peerFingerprint: 'windows_peer_fingerprint'
      }),
      call: async (_selector, method, params, _timeoutMs, envelope) => {
        remoteMethods.push(method)
        if (method === 'status.get') {
          return {
            id: 'status',
            ok: true,
            result: workerRuntime.getStatus(),
            _meta: { runtimeId: workerRuntime.getRuntimeId() }
          }
        }
        return (await workerDispatcher.dispatch({
          id: `remote_${method}`,
          authToken: 'run-home-device-token',
          method,
          params,
          orchestrationContractVersion: envelope?.orchestrationContractVersion,
          orchestrationRequestId: envelope?.orchestrationRequestId,
          orchestrationCapability: envelope?.orchestrationCapability
        })) as RuntimeRpcResponse<unknown>
      }
    }
    homeRuntime = new OrcaRuntimeService(null, undefined, {
      orchestrationEnvironmentTransport: transport
    })
    homeRuntime.setOrchestrationDb(homeDb)
    homeDispatcher = new RpcDispatcher({ runtime: homeRuntime, methods: ORCHESTRATION_METHODS })
    vi.spyOn(homeRuntime, 'getTerminalPaneKey').mockImplementation((handle) =>
      handle === 'term_coord' ? 'tab_coord:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' : null
    )
  })

  afterEach(() => {
    homeRuntime.stopOrchestrationFederationRelay()
    homeDb.close()
    workerDb.close()
    vi.restoreAllMocks()
  })

  async function start(runId: string, followUp: boolean): Promise<string> {
    const task = homeDb.createTask({ spec: followUp ? 'Rebase' : 'Remote work', runId })
    const request = followUp
      ? startRequest(task.id, {
          worktree: `id:${WORKTREE}`,
          terminal: TERMINAL,
          repo: undefined,
          name: undefined,
          agent: undefined
        })
      : startRequest(task.id)
    await homeDispatcher.dispatch({
      ...request,
      orchestrationRequestId: `request_${task.id}`
    })
    homeRuntime.stopOrchestrationFederationRelay()
    return homeDb.getDispatchContext(task.id)!.id
  }

  async function finish(dispatchId: string): Promise<void> {
    const prompt = vi.mocked(workerRuntime.sendTerminalAgentPrompt).mock.calls.at(-1)?.[1] ?? ''
    const taskId = homeDb.getDispatchContextById(dispatchId)!.task_id
    const sent = workerDispatcher.dispatch({
      id: `rpc_done_${dispatchId}`,
      authToken: 'worker-local-token',
      orchestrationContractVersion: ORCHESTRATION_CONTRACT_VERSION,
      orchestrationRequestId: `done_${dispatchId}`,
      orchestrationCapability: prompt.match(/--dispatch-capability (dcap_[A-Za-z0-9_-]+)/)?.[1],
      method: 'orchestration.send',
      params: {
        from: TERMINAL,
        subject: 'Done',
        type: 'worker_done',
        payload: JSON.stringify({ taskId, dispatchId, outcome: 'succeeded' })
      }
    })
    await vi.waitFor(() =>
      expect(workerDb.listPendingFederationRelay(dispatchId, 'to_home')).toHaveLength(1)
    )
    await homeRuntime.syncOrchestrationFederation()
    await sent
    expect(homeDb.getWorkerDispatch(dispatchId)?.state).toBe('succeeded')
  }

  async function memberWithFollowUp() {
    const run = homeDb.createRun({
      objective: 'Remote members',
      coordinatorHandle: 'term_coord',
      coordinatorPaneKey: 'tab_coord:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
    })
    const first = await start(run.id, false)
    await finish(first)
    const followUp = await start(run.id, true)
    return { run, first, followUp }
  }

  function release(dispatchId: string, requestId = `release_${dispatchId}`) {
    return homeDispatcher.dispatch({
      id: `rpc_${requestId}`,
      authToken: 'coordinator-token',
      orchestrationContractVersion: ORCHESTRATION_CONTRACT_VERSION,
      orchestrationRequestId: requestId,
      method: 'orchestration.workerRelease',
      params: { dispatch: dispatchId }
    })
  }

  it('releases the first dispatch with its follow-up, so the host closes and removes them', async () => {
    const { run, first, followUp } = await memberWithFollowUp()
    await finish(followUp)

    const response = await release(followUp)

    expect(response).toMatchObject({
      ok: true,
      result: {
        dispatchId: followUp,
        state: 'released',
        remote: { closedTerminals: [TERMINAL], removedWorktree: WORKTREE },
        worktreeDispatches: [{ dispatchId: first, state: 'released' }]
      }
    })
    expect(workerRuntime.removeManagedWorktree).toHaveBeenCalledWith(`id:${WORKTREE}`, false)
    expect(homeDb.getWorkerDispatch(first)?.stage).toBe('released')
    expect(listRemoteGameMemberSources(homeDb, run.id)).toEqual([])
  })

  it('frees a member whose follow-up an earlier build released alone', async () => {
    const { run, first, followUp } = await memberWithFollowUp()
    await finish(followUp)
    homeDb.markFederatedWorkerReleased(followUp)
    workerDb.markRemoteAttachmentReleased(followUp)
    expect(listRemoteGameMemberSources(homeDb, run.id).map((one) => one.dispatchId)).toEqual([
      first
    ])

    const response = await release(followUp)

    expect(response).toMatchObject({
      ok: true,
      result: {
        state: 'released',
        remote: { closedTerminals: [TERMINAL], removedWorktree: WORKTREE },
        worktreeDispatches: [{ dispatchId: first, state: 'released' }]
      }
    })
    expect(listRemoteGameMemberSources(homeDb, run.id)).toEqual([])
    await expect(release(followUp, 'release_again')).resolves.toMatchObject({
      ok: true,
      result: { state: 'already_released' }
    })
  })

  // Why: an unproven stop may leave its process running in the terminal and worktree the first dispatch owns.
  function stopUnproven(dispatchId: string): void {
    const sqlite = (homeDb as unknown as { db: { prepare: (sql: string) => { run: () => void } } })
      .db
    sqlite
      .prepare(
        `UPDATE worker_dispatches SET state = 'stop_unknown', stage = 'stop_outcome_unknown'
         WHERE dispatch_id = '${dispatchId}'`
      )
      .run()
  }

  it.each(['stop_unknown', 'stopping'])(
    'touches nothing on the host while a follow-up in %s may still run there',
    async (state) => {
      const { run, first, followUp } = await memberWithFollowUp()
      stopUnproven(followUp)
      if (state === 'stopping') {
        const sqlite = (
          homeDb as unknown as { db: { prepare: (sql: string) => { run: () => void } } }
        ).db
        sqlite
          .prepare(
            `UPDATE worker_dispatches SET state = 'stopping' WHERE dispatch_id = '${followUp}'`
          )
          .run()
      }

      const response = await release(first)

      expect(response).toMatchObject({
        ok: true,
        result: { state: 'retained', reason: 'not_settled' }
      })
      expect(JSON.stringify(response)).toContain(followUp)
      expect(remoteMethods).not.toContain('orchestration.federationRelease')
      expect(workerRuntime.closeTerminal).not.toHaveBeenCalled()
      expect(workerRuntime.removeManagedWorktree).not.toHaveBeenCalled()
      expect(listRemoteGameMemberSources(homeDb, run.id)).toHaveLength(2)
    }
  )

  it('frees the member once the host shows nothing of a stop_unknown follow-up is left', async () => {
    const { run, first, followUp } = await memberWithFollowUp()
    stopUnproven(followUp)
    vi.mocked(workerRuntime.showTerminal).mockRejectedValue(new Error('terminal_handle_stale'))

    const response = await release(followUp)

    expect(response).toMatchObject({
      ok: true,
      result: {
        state: 'released',
        worktreeDispatches: [{ dispatchId: first, state: 'released' }]
      }
    })
    expect(workerRuntime.removeManagedWorktree).toHaveBeenCalledWith(`id:${WORKTREE}`, false)
    expect(listRemoteGameMemberSources(homeDb, run.id)).toEqual([])
  })

  it('touches nothing on the host while a follow-up in that worktree still runs', async () => {
    const { run, first, followUp } = await memberWithFollowUp()

    const response = await release(first)

    expect(response).toMatchObject({
      ok: true,
      result: { state: 'retained', reason: 'not_settled' }
    })
    expect(JSON.stringify(response)).toContain(followUp)
    expect(remoteMethods).not.toContain('orchestration.federationRelease')
    expect(workerRuntime.closeTerminal).not.toHaveBeenCalled()
    expect(listRemoteGameMemberSources(homeDb, run.id).map((one) => one.dispatchId)).toEqual([
      first,
      followUp
    ])
  })
})
