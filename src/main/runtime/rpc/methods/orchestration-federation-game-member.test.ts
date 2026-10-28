import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest'
import type { RuntimeRpcResponse } from '../../../../shared/runtime-rpc-envelope'
import {
  ORCHESTRATION_FEDERATION_GAME_MEMBER_RUNTIME_CAPABILITY,
  ORCHESTRATION_FEDERATION_GAME_SCENE_RUNTIME_CAPABILITY
} from '../../../../shared/protocol-version'
import { OrcaRuntimeService } from '../../orca-runtime'
import { OrchestrationDb } from '../../orchestration/db'
import { WorkerSetupAdmission } from '../../orchestration/worker-setup-admission'
import type { OrchestrationEnvironmentTransport } from '../../orchestration/environment-transport'
import { RpcDispatcher } from '../dispatcher'
import { ORCHESTRATION_METHODS } from './orchestration'
import { createFederationWorkerStartRequest as startRequest } from './orchestration-federation-test-request'
import { configureWorkerRuntime } from './orchestration-federation-worker-runtime-mocks'

const GAME_MEMBER_FIELDS = ['game', 'setupAdmission'] as const
const SCENE = { id: 'file:mario-bros', text: '{"name":"Mario Bros"}' }

// Why: an older remote's attach schema strips unknown fields, so a game member sent
// there without a capability check becomes a silent plain worker (ORCA-792).
describe('federated game members across versions', () => {
  let homeDb: OrchestrationDb
  let workerDb: OrchestrationDb
  let homeRuntime: OrcaRuntimeService
  let workerRuntime: OrcaRuntimeService
  let homeDispatcher: RpcDispatcher
  let workerCapabilities: string[]
  let attachParams: Record<string, unknown>[]
  let workerAdmission: WorkerSetupAdmission
  let readLeadScene: MockInstance<OrcaRuntimeService['readCallerGameScene']>

  function useOlderWorkerBuild(): void {
    workerCapabilities = workerCapabilities.filter(
      (capability) => capability !== ORCHESTRATION_FEDERATION_GAME_MEMBER_RUNTIME_CAPABILITY
    )
  }

  function useBuildWithoutScenes(): void {
    workerCapabilities = workerCapabilities.filter(
      (capability) => capability !== ORCHESTRATION_FEDERATION_GAME_SCENE_RUNTIME_CAPABILITY
    )
  }

  beforeEach(() => {
    homeDb = new OrchestrationDb(':memory:')
    workerDb = new OrchestrationDb(':memory:')
    workerRuntime = new OrcaRuntimeService()
    workerRuntime.setOrchestrationDb(workerDb)
    configureWorkerRuntime(workerRuntime)
    workerAdmission = new WorkerSetupAdmission({
      readMemory: async () => ({
        totalMemory: 16,
        availableMemory: 16,
        swapTotal: null,
        swapUsed: null,
        kernelLevel: null,
        source: 'fallback',
        readAt: 0
      })
    })
    vi.spyOn(workerRuntime, 'getWorkerSetupAdmission').mockReturnValue(workerAdmission)
    const workerDispatcher = new RpcDispatcher({
      runtime: workerRuntime,
      methods: ORCHESTRATION_METHODS
    })
    workerCapabilities = [...(workerRuntime.getStatus().capabilities ?? [])]
    attachParams = []
    const transport: OrchestrationEnvironmentTransport = {
      resolve: () => ({
        environmentId: 'environment_windows',
        name: 'windows',
        peerFingerprint: 'windows_peer_fingerprint'
      }),
      call: async (_selector, method, params, _timeoutMs, envelope) => {
        if (method === 'status.get') {
          return {
            id: 'status',
            ok: true,
            result: { ...workerRuntime.getStatus(), capabilities: workerCapabilities },
            _meta: { runtimeId: workerRuntime.getRuntimeId() }
          }
        }
        const sent = { ...(params as Record<string, unknown>) }
        if (method === 'orchestration.federationAttachStart') {
          attachParams.push({ ...sent })
          if (
            !workerCapabilities.includes(ORCHESTRATION_FEDERATION_GAME_MEMBER_RUNTIME_CAPABILITY)
          ) {
            for (const field of GAME_MEMBER_FIELDS) {
              delete sent[field]
            }
          }
          if (
            !workerCapabilities.includes(ORCHESTRATION_FEDERATION_GAME_SCENE_RUNTIME_CAPABILITY)
          ) {
            delete sent.gameScene
          }
        }
        return (await workerDispatcher.dispatch({
          id: `remote_${method}`,
          authToken: 'run-home-device-token',
          method,
          params: sent,
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
    readLeadScene = vi.spyOn(homeRuntime, 'readCallerGameScene').mockResolvedValue(SCENE)
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

  function createHomeTask() {
    const run = homeDb.createRun({
      objective: 'Game wave across hosts',
      coordinatorHandle: 'term_coord',
      coordinatorPaneKey: 'tab_coord:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
    })
    return homeDb.createTask({ spec: 'Member work', runId: run.id })
  }

  it('advertises the game-member capability on a current build', () => {
    expect(workerRuntime.getStatus().capabilities).toContain(
      ORCHESTRATION_FEDERATION_GAME_MEMBER_RUNTIME_CAPABILITY
    )
  })

  it('keeps the lead scene for a game member on a remote that carries scenes', async () => {
    expect(workerRuntime.getStatus().capabilities).toContain(
      ORCHESTRATION_FEDERATION_GAME_SCENE_RUNTIME_CAPABILITY
    )
    const task = createHomeTask()

    const response = await homeDispatcher.dispatch(startRequest(task.id, { game: true }))

    expect(response).toMatchObject({ ok: true, result: { state: 'ready' } })
    expect(readLeadScene).toHaveBeenCalledWith('term_coord')
    expect(attachParams[0]).toMatchObject({ game: true, gameScene: SCENE })
    expect(workerDb.getGameSceneForWorktree('repo::windows-worktree')).toEqual(SCENE)
  })

  it('starts the game member without the scene on a remote older than scenes', async () => {
    useBuildWithoutScenes()
    const task = createHomeTask()

    const response = await homeDispatcher.dispatch(startRequest(task.id, { game: true }))

    expect(response).toMatchObject({ ok: true, result: { state: 'ready' } })
    expect(attachParams[0]).toMatchObject({ game: true })
    expect(attachParams[0]).not.toHaveProperty('gameScene')
    expect(workerRuntime.createManagedWorktree).toHaveBeenCalledWith(
      expect.objectContaining({ orchestrationGameMember: true })
    )
    expect(workerDb.getGameSceneForWorktree('repo::windows-worktree')).toBeNull()
  })

  it('sends no scene for a plain worker', async () => {
    const task = createHomeTask()

    await homeDispatcher.dispatch(startRequest(task.id))

    expect(readLeadScene).not.toHaveBeenCalled()
    expect(attachParams[0]).not.toHaveProperty('gameScene')
    expect(workerDb.getGameSceneForWorktree('repo::windows-worktree')).toBeNull()
  })

  it('refuses a game member for an older remote by name and starts nothing', async () => {
    useOlderWorkerBuild()
    const task = createHomeTask()

    const response = await homeDispatcher.dispatch(
      startRequest(task.id, { game: true, setupAdmission: 'queue' })
    )

    expect(response).toMatchObject({ ok: false, error: { code: 'capability_unsupported' } })
    expect(JSON.stringify(response)).toContain(
      ORCHESTRATION_FEDERATION_GAME_MEMBER_RUNTIME_CAPABILITY
    )
    expect(attachParams).toHaveLength(0)
    expect(homeDb.getDispatchContext(task.id)).toBeFalsy()
    expect(workerRuntime.createManagedWorktree).not.toHaveBeenCalled()
  })

  it('starts a game member on a capable remote and forwards setup admission', async () => {
    const task = createHomeTask()

    const response = await homeDispatcher.dispatch(
      startRequest(task.id, { game: true, setupAdmission: 'queue' })
    )

    expect(response).toMatchObject({ ok: true, result: { state: 'ready' } })
    expect(attachParams[0]).toMatchObject({ game: true, setupAdmission: 'queue' })
    expect(workerRuntime.createManagedWorktree).toHaveBeenCalledWith(
      expect.objectContaining({ orchestrationGameMember: true })
    )
  })

  it.each([
    ['an older', true],
    ['a current', false]
  ])('starts a plain worker unchanged on %s remote', async (_label, older) => {
    if (older) {
      useOlderWorkerBuild()
    }
    const task = createHomeTask()

    const response = await homeDispatcher.dispatch(startRequest(task.id))

    expect(response).toMatchObject({ ok: true, result: { state: 'ready' } })
    expect(attachParams[0]).not.toHaveProperty('game')
    expect(attachParams[0]).not.toHaveProperty('setupAdmission')
    expect(workerRuntime.createManagedWorktree).toHaveBeenCalledWith(
      expect.not.objectContaining({ orchestrationGameMember: expect.anything() })
    )
  })

  it('marks an exact folder worker as a game member on a capable remote', async () => {
    vi.spyOn(workerRuntime, 'showManagedTerminalWorkspace').mockResolvedValue({
      id: 'folder:remote-workspace'
    } as never)
    const createTerminal = vi.spyOn(workerRuntime, 'createTerminal').mockResolvedValue({
      handle: 'term_windows_worker',
      worktreeId: 'folder:remote-workspace',
      title: 'worker'
    })
    const task = createHomeTask()

    const response = await homeDispatcher.dispatch(
      startRequest(task.id, {
        worktree: 'folder:remote-workspace',
        repo: undefined,
        name: undefined,
        game: true
      })
    )

    expect(response).toMatchObject({ ok: true, result: { state: 'ready' } })
    expect(createTerminal).toHaveBeenCalledWith(
      'id:folder:remote-workspace',
      expect.objectContaining({ orchestrationGameMember: true })
    )
  })

  it('refuses by name when the remote setup slot is busy, and starts nothing', async () => {
    const holder = await workerAdmission.admit({
      host: 'local',
      taskId: 'task_other',
      label: 'other-member',
      start: () => {}
    })
    expect(holder.admitted).toBe(true)
    const task = createHomeTask()

    const response = await homeDispatcher.dispatch(
      startRequest(task.id, { game: true, setupAdmission: 'queue' })
    )

    expect(response).toMatchObject({
      ok: true,
      result: {
        state: 'failed',
        refusal: { code: 'setup_slot_busy', data: { host: 'local', waitingOn: 'other-member' } }
      }
    })
    expect(workerRuntime.createManagedWorktree).not.toHaveBeenCalled()
    expect(workerAdmission.queued()).toEqual([])
    expect(workerAdmission.startingTaskIds()).toEqual(['task_other'])
  })

  it('holds the remote setup slot until the new worktree setup ends', async () => {
    vi.mocked(workerRuntime.createManagedWorktree).mockResolvedValue({
      worktree: { id: 'repo::windows-worktree', repoId: 'repo' },
      startupTerminal: { spawned: true, handle: 'term_windows_worker' },
      setupReceipt: {
        requested: 'run',
        hookFound: true,
        startupPolicy: 'start-immediately',
        state: 'running',
        terminalHandle: 'term_windows_setup'
      }
    } as never)
    let finishSetup: (value: { exitCode: number | null }) => void = () => {}
    const setupDone = vi.spyOn(workerRuntime, 'waitForSetupTerminalCompletion').mockReturnValue(
      new Promise((resolve) => {
        finishSetup = resolve
      })
    )
    const task = createHomeTask()

    const response = await homeDispatcher.dispatch(
      startRequest(task.id, { game: true, setupAdmission: 'queue' })
    )

    expect(response).toMatchObject({ ok: true, result: { state: 'ready' } })
    expect(setupDone).toHaveBeenCalledWith('term_windows_setup')
    expect(workerAdmission.startingTaskIds()).toEqual([task.id])
    finishSetup({ exitCode: 0 })
    await vi.waitFor(() => expect(workerAdmission.startingTaskIds()).toEqual([]))
  })

  it('releases the remote setup slot when the start fails', async () => {
    vi.spyOn(workerRuntime, 'isTerminalRunningAgent').mockResolvedValue(false)
    const task = createHomeTask()

    const response = await homeDispatcher.dispatch(
      startRequest(task.id, { game: true, setupAdmission: 'queue' })
    )

    expect(response).toMatchObject({ ok: true, result: { state: 'failed' } })
    expect(workerAdmission.startingTaskIds()).toEqual([])
  })
})
