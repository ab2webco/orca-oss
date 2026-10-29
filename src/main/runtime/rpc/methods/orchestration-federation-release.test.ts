import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  ORCHESTRATION_CONTRACT_VERSION,
  ORCHESTRATION_FEDERATION_RELEASE_RUNTIME_CAPABILITY
} from '../../../../shared/protocol-version'
import type { OrchestratorGameState } from '../../../../shared/orchestrator-game-state'
import type { RuntimeRpcResponse } from '../../../../shared/runtime-rpc-envelope'
import { OrcaRuntimeService } from '../../orca-runtime'
import { OrchestrationDb } from '../../orchestration/db'
import type { OrchestrationEnvironmentTransport } from '../../orchestration/environment-transport'
import { listRemoteGameMemberSources } from '../../orchestrator-game-remote-members'
import { RpcDispatcher } from '../dispatcher'
import { ORCHESTRATION_METHODS } from './orchestration'
import { createFederationWorkerStartRequest as startRequest } from './orchestration-federation-test-request'
import { configureWorkerRuntime } from './orchestration-federation-worker-runtime-mocks'
import { ORCHESTRATOR_GAME_METHODS } from './orchestrator-game'
import { WORKTREE_METHODS } from './worktree'

// Why: a finished remote member could not be released, so it stayed in the fleet and its
// terminal and worktree stayed on the remote host (ORCA-790).
describe('releasing a remote worker through the relay', () => {
  let homeDb: OrchestrationDb
  let workerDb: OrchestrationDb
  let homeRuntime: OrcaRuntimeService
  let workerRuntime: OrcaRuntimeService
  let homeDispatcher: RpcDispatcher
  let workerDispatcher: RpcDispatcher
  let workerCapabilities: string[]
  let remoteMethods: string[]

  beforeEach(() => {
    homeDb = new OrchestrationDb(':memory:')
    workerDb = new OrchestrationDb(':memory:')
    workerRuntime = new OrcaRuntimeService()
    workerRuntime.setOrchestrationDb(workerDb)
    configureWorkerRuntime(workerRuntime)
    vi.spyOn(workerRuntime, 'removeManagedWorktree').mockResolvedValue({} as never)
    workerDispatcher = new RpcDispatcher({
      runtime: workerRuntime,
      methods: [...ORCHESTRATION_METHODS, ...WORKTREE_METHODS]
    })
    workerCapabilities = [...(workerRuntime.getStatus().capabilities ?? [])]
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
            result: { ...workerRuntime.getStatus(), capabilities: workerCapabilities },
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

  async function startRemoteMember() {
    const run = homeDb.createRun({
      objective: 'Remote members',
      coordinatorHandle: 'term_coord',
      coordinatorPaneKey: 'tab_coord:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
    })
    const task = homeDb.createTask({ spec: 'Remote work', runId: run.id })
    await homeDispatcher.dispatch(startRequest(task.id))
    homeRuntime.stopOrchestrationFederationRelay()
    return { run, task, dispatch: homeDb.getDispatchContext(task.id)! }
  }

  async function finishRemoteMember(taskId: string, dispatchId: string): Promise<void> {
    const prompt = vi.mocked(workerRuntime.sendTerminalAgentPrompt).mock.calls[0]?.[1] ?? ''
    const sent = workerDispatcher.dispatch({
      id: 'rpc_worker_done',
      authToken: 'worker-local-token',
      orchestrationContractVersion: ORCHESTRATION_CONTRACT_VERSION,
      orchestrationRequestId: 'worker_done_request',
      orchestrationCapability: prompt.match(/--dispatch-capability (dcap_[A-Za-z0-9_-]+)/)?.[1],
      method: 'orchestration.send',
      params: {
        from: 'term_windows_worker',
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
    expect(workerDb.getRemoteDispatchAttachment(dispatchId)?.state).toBe('succeeded')
  }

  function release(dispatchId: string, requestId = 'release_request') {
    return homeDispatcher.dispatch({
      id: `rpc_${requestId}`,
      authToken: 'coordinator-token',
      orchestrationContractVersion: ORCHESTRATION_CONTRACT_VERSION,
      orchestrationRequestId: requestId,
      method: 'orchestration.workerRelease',
      params: { dispatch: dispatchId }
    })
  }

  it('closes the remote terminal, removes its worktree and drops it from the fleet', async () => {
    const { run, task, dispatch } = await startRemoteMember()
    await finishRemoteMember(task.id, dispatch.id)

    const response = await release(dispatch.id)

    expect(response).toMatchObject({
      ok: true,
      result: {
        dispatchId: dispatch.id,
        state: 'released',
        processAction: 'closed_agent_terminal',
        remote: {
          closedTerminals: ['term_windows_worker'],
          removedWorktree: 'repo::windows-worktree'
        }
      }
    })
    expect(workerRuntime.closeTerminal).toHaveBeenCalledWith('term_windows_worker')
    // Why not force: a dirty remote tree must survive; the branch is kept either way.
    expect(workerRuntime.removeManagedWorktree).toHaveBeenCalledWith(
      'id:repo::windows-worktree',
      false
    )
    expect(listRemoteGameMemberSources(homeDb, run.id)).toEqual([])
  })

  it('answers already_released on a repeat without touching the host again', async () => {
    const { task, dispatch } = await startRemoteMember()
    await finishRemoteMember(task.id, dispatch.id)
    await release(dispatch.id)
    vi.mocked(workerRuntime.closeTerminal).mockClear()

    const response = await release(dispatch.id, 'release_again')

    expect(response).toMatchObject({ ok: true, result: { state: 'already_released' } })
    expect(workerRuntime.closeTerminal).not.toHaveBeenCalled()
  })

  it('keeps the member when its worktree has changes, and says so', async () => {
    vi.mocked(workerRuntime.removeManagedWorktree).mockRejectedValue(
      new Error('worktree contains modified or untracked files')
    )
    const { run, task, dispatch } = await startRemoteMember()
    await finishRemoteMember(task.id, dispatch.id)

    const response = await release(dispatch.id)

    expect(response).toMatchObject({
      ok: true,
      result: {
        state: 'released',
        remote: {
          removedWorktree: null,
          worktreeError: 'worktree contains modified or untracked files'
        }
      }
    })
    expect(listRemoteGameMemberSources(homeDb, run.id)).toEqual([])
  })

  it('retains a remote member that has not finished, closing nothing', async () => {
    const { dispatch } = await startRemoteMember()

    const response = await release(dispatch.id)

    expect(response).toMatchObject({
      ok: true,
      result: { state: 'retained', reason: 'not_settled' }
    })
    expect(remoteMethods).not.toContain('orchestration.federationRelease')
    expect(workerRuntime.closeTerminal).not.toHaveBeenCalled()
  })

  it('retains on an older host without the release capability and calls nothing there', async () => {
    workerCapabilities = workerCapabilities.filter(
      (capability) => capability !== ORCHESTRATION_FEDERATION_RELEASE_RUNTIME_CAPABILITY
    )
    const { task, dispatch } = await startRemoteMember()
    await finishRemoteMember(task.id, dispatch.id)

    const response = await release(dispatch.id)

    expect(response).toMatchObject({
      ok: true,
      result: { state: 'retained', reason: 'federation_unsupported' }
    })
    expect(JSON.stringify(response)).toContain('update Orca on windows')
    expect(remoteMethods).not.toContain('orchestration.federationRelease')
  })

  function useOlderWorkerBuild(): void {
    workerCapabilities = workerCapabilities.filter(
      (capability) => capability !== ORCHESTRATION_FEDERATION_RELEASE_RUNTIME_CAPABILITY
    )
  }

  function forgetOnHost(dispatchId: string): void {
    const sqlite = (
      workerDb as unknown as { db: { prepare: (sql: string) => { run: (id: string) => void } } }
    ).db
    sqlite.prepare('DELETE FROM remote_dispatch_attachments WHERE dispatch_id = ?').run(dispatchId)
  }

  function leaveNothingOnHost(): void {
    vi.mocked(workerRuntime.showTerminal).mockRejectedValue(new Error('terminal_handle_stale'))
    vi.spyOn(workerRuntime, 'showManagedWorktree').mockRejectedValue(
      new Error('selector_not_found')
    )
  }

  // Why: ORCA-826's terminal and worktree were removed by hand on the iMac, so its row stayed a ghost.
  describe('when nothing of the member is left on its host', () => {
    it('settles when a capable host no longer has the dispatch', async () => {
      const { run, task, dispatch } = await startRemoteMember()
      await finishRemoteMember(task.id, dispatch.id)
      forgetOnHost(dispatch.id)

      const response = await release(dispatch.id)

      expect(response).toMatchObject({
        ok: true,
        result: { state: 'released', remote: { alreadyGone: true } }
      })
      expect(listRemoteGameMemberSources(homeDb, run.id)).toEqual([])
    })

    it('does not report a worktree that was already removed as an error', async () => {
      vi.mocked(workerRuntime.removeManagedWorktree).mockRejectedValue(
        new Error('selector_not_found')
      )
      const { task, dispatch } = await startRemoteMember()
      await finishRemoteMember(task.id, dispatch.id)

      const response = await release(dispatch.id)

      expect(response).toMatchObject({ ok: true, result: { state: 'released' } })
      expect(JSON.stringify(response)).not.toContain('worktreeError')
    })

    it('settles on an older host that no longer has the dispatch', async () => {
      useOlderWorkerBuild()
      const { run, task, dispatch } = await startRemoteMember()
      await finishRemoteMember(task.id, dispatch.id)
      forgetOnHost(dispatch.id)

      const response = await release(dispatch.id)

      expect(response).toMatchObject({
        ok: true,
        result: { state: 'released', remote: { alreadyGone: true } }
      })
      expect(remoteMethods).not.toContain('orchestration.federationRelease')
      expect(listRemoteGameMemberSources(homeDb, run.id)).toEqual([])
    })

    it('settles on an older host once its terminal and worktree are gone', async () => {
      useOlderWorkerBuild()
      const { run, task, dispatch } = await startRemoteMember()
      await finishRemoteMember(task.id, dispatch.id)
      leaveNothingOnHost()

      const response = await release(dispatch.id)

      expect(response).toMatchObject({
        ok: true,
        result: { state: 'released', processAction: 'none', remote: { alreadyGone: true } }
      })
      expect(workerRuntime.closeTerminal).not.toHaveBeenCalled()
      expect(listRemoteGameMemberSources(homeDb, run.id)).toEqual([])
    })

    it('keeps an older host retained while its worktree is still there', async () => {
      useOlderWorkerBuild()
      const { task, dispatch } = await startRemoteMember()
      await finishRemoteMember(task.id, dispatch.id)
      vi.mocked(workerRuntime.showTerminal).mockRejectedValue(new Error('terminal_handle_stale'))
      vi.spyOn(workerRuntime, 'showManagedWorktree').mockResolvedValue({ id: 'wt' } as never)

      const response = await release(dispatch.id)

      expect(response).toMatchObject({
        ok: true,
        result: { state: 'retained', reason: 'federation_unsupported' }
      })
    })
  })

  function stop(dispatchId: string, requestId = 'stop_request') {
    return homeDispatcher.dispatch({
      id: `rpc_${requestId}`,
      authToken: 'coordinator-token',
      orchestrationContractVersion: ORCHESTRATION_CONTRACT_VERSION,
      orchestrationRequestId: requestId,
      method: 'orchestration.workerStop',
      params: { dispatch: dispatchId }
    })
  }

  // Why: the host's PTY is dead after a restart, so its process incarnation no longer matches.
  function killPtyOnHost(): void {
    vi.mocked(workerRuntime.showTerminal).mockResolvedValue({
      handle: 'term_windows_worker',
      connected: false,
      liveness: 'gone'
    } as never)
    vi.mocked(workerRuntime.getTerminalProcessIncarnation).mockReturnValue(null)
  }

  // Why: imac rows for ORCA-854/855/857 answered stop_unknown to worker-stop and not_settled to worker-release, so nothing cleared them and they filled the cap.
  describe('when a stop cannot reach the member it names (ORCA-864)', () => {
    it('settles the stop when the host has no record of the dispatch', async () => {
      const { run, dispatch } = await startRemoteMember()
      forgetOnHost(dispatch.id)

      const stopped = await stop(dispatch.id)

      expect(stopped).toMatchObject({
        ok: true,
        result: { state: 'stopped', processAction: 'none' }
      })
      expect(JSON.stringify(stopped)).toContain('windows has no record of this member')
      await expect(release(dispatch.id)).resolves.toMatchObject({
        ok: true,
        result: { state: 'released', remote: { alreadyGone: true } }
      })
      expect(listRemoteGameMemberSources(homeDb, run.id)).toEqual([])
    })

    it('settles the stop when the host terminal is a dead PTY, then releases its worktree', async () => {
      const { run, dispatch } = await startRemoteMember()
      killPtyOnHost()

      const stopped = await stop(dispatch.id)

      expect(stopped).toMatchObject({
        ok: true,
        result: { state: 'stopped', processAction: 'none' }
      })
      expect(workerRuntime.closeTerminal).not.toHaveBeenCalled()
      expect(workerDb.getRemoteDispatchAttachment(dispatch.id)?.state).toBe('stopped')
      await expect(release(dispatch.id)).resolves.toMatchObject({
        ok: true,
        result: { state: 'released', remote: { removedWorktree: 'repo::windows-worktree' } }
      })
      expect(listRemoteGameMemberSources(homeDb, run.id)).toEqual([])
    })

    it('releases a stop_unknown member once its host shows nothing is left', async () => {
      const { run, dispatch } = await startRemoteMember()
      vi.mocked(workerRuntime.getTerminalProcessIncarnation).mockReturnValue('another:pty:2')
      await expect(stop(dispatch.id)).resolves.toMatchObject({
        ok: true,
        result: { state: 'stop_unknown' }
      })

      const stillThere = await release(dispatch.id)
      expect(stillThere).toMatchObject({
        ok: true,
        result: { state: 'retained', reason: 'not_settled' }
      })
      expect(JSON.stringify(stillThere)).toContain('Close its terminal on windows')

      killPtyOnHost()
      vi.spyOn(workerRuntime, 'showManagedWorktree').mockRejectedValue(
        new Error('selector_not_found')
      )
      const response = await release(dispatch.id, 'release_after_gone')

      expect(response).toMatchObject({
        ok: true,
        result: { state: 'released', remote: { alreadyGone: true } }
      })
      expect(homeDb.getWorkerDispatch(dispatch.id)?.state).toBe('stopped')
      expect(listRemoteGameMemberSources(homeDb, run.id)).toEqual([])
    })

    it('tells a member that has not finished how to stop it', async () => {
      const { dispatch } = await startRemoteMember()

      const response = await release(dispatch.id)

      expect(JSON.stringify(response)).toContain(`worker-stop --dispatch ${dispatch.id}`)
    })
  })

  // Why: the owner saw finished remote members stay in the fleet and Panel for hours (ORCA-864).
  describe("when a remote member's work lands after its worker_done (ORCA-864)", () => {
    async function leadReads(dispatchId: string, state: 'done' | 'working') {
      const postEvent = vi.fn().mockResolvedValue({ posted: true })
      vi.spyOn(homeRuntime, 'getGameBoard').mockReturnValue({ postEvent } as never)
      vi.spyOn(homeRuntime, 'getOrchestratorGameState').mockResolvedValue({
        role: 'lead',
        agents: [
          {
            paneKey: `remote:${dispatchId}`,
            displayName: 'ORCA-41 Cartelera',
            agentType: null,
            state,
            toolName: null,
            isLeader: false,
            isMember: true,
            terminalHandle: 'term_windows_worker',
            review: {
              provider: 'github',
              number: 41,
              title: 'Cartelera',
              url: 'https://github.com/o/r/pull/41',
              state: 'merged',
              ci: 'success'
            },
            remote: { host: 'windows', stateKnown: true, ticketDone: true }
          }
        ]
      } as OrchestratorGameState)
      const method = ORCHESTRATOR_GAME_METHODS.find((one) => one.name === 'game.state')!
      const read = (await method.handler(method.params!.parse({ worktreeId: 'wt-lead' }), {
        runtime: homeRuntime
      })) as OrchestratorGameState
      return { read, postEvent }
    }

    it('releases it on its host, drops its row and posts one line for the lead', async () => {
      const { run, task, dispatch } = await startRemoteMember()
      await finishRemoteMember(task.id, dispatch.id)

      const { read, postEvent } = await leadReads(dispatch.id, 'done')

      expect(read.agents).toEqual([])
      await vi.waitFor(() => expect(postEvent).toHaveBeenCalledTimes(1))
      expect(workerRuntime.closeTerminal).toHaveBeenCalledWith('term_windows_worker')
      expect(listRemoteGameMemberSources(homeDb, run.id)).toEqual([])
      expect(postEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          kind: 'stopped',
          ticket: 'ORCA-41',
          key: `auto-release:${dispatch.id}`,
          text: 'Released automatically: PR #41 merged after worker_done; its terminal on windows closed.'
        })
      )
    })

    it('never touches a remote member its host reports working (ORCA-862)', async () => {
      const { task, dispatch } = await startRemoteMember()
      await finishRemoteMember(task.id, dispatch.id)

      const { read } = await leadReads(dispatch.id, 'working')

      expect(read.agents).toHaveLength(1)
      expect(remoteMethods).not.toContain('orchestration.federationRelease')
      expect(workerRuntime.closeTerminal).not.toHaveBeenCalled()
    })
  })
})
