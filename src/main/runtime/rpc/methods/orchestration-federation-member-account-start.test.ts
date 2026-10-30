import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RuntimeRpcResponse } from '../../../../shared/runtime-rpc-envelope'
import { ORCHESTRATION_FEDERATION_MEMBER_ACCOUNT_RUNTIME_CAPABILITY } from '../../../../shared/protocol-version'
import { OrcaRuntimeService } from '../../orca-runtime'
import { OrchestrationDb } from '../../orchestration/db'
import type { OrchestrationEnvironmentTransport } from '../../orchestration/environment-transport'
import { RpcDispatcher } from '../dispatcher'
import { ORCHESTRATION_METHODS } from './orchestration'
import { createFederationWorkerStartRequest as startRequest } from './orchestration-federation-test-request'
import { configureWorkerRuntime } from './orchestration-federation-worker-runtime-mocks'

const NOW = Date.now()

const window = (usedPercent: number) => ({
  usedPercent,
  windowMinutes: 300,
  resetsAt: NOW + 3_600_000,
  resetDescription: null
})

const limits = (usedPercent: number) => ({
  status: 'ok',
  session: window(usedPercent),
  weekly: null,
  updatedAt: NOW,
  error: null,
  source: 'api'
})

// Why: the host roster the remote resolves against; the home never sees these ids.
const WORKER_ACCOUNTS = {
  claude: {
    accounts: [
      {
        id: 'imac-ana',
        email: 'ana@koombea.com',
        authMethod: 'subscription-oauth'
      },
      {
        id: 'imac-ops',
        email: 'ops@netsat.co',
        authMethod: 'subscription-oauth'
      }
    ],
    activeAccountId: 'imac-ops'
  },
  codex: { accounts: [], activeAccountId: null },
  rateLimits: {
    claude: limits(5),
    codex: null,
    inactiveClaudeAccounts: [{ accountId: 'imac-ana', rateLimits: limits(40) }],
    inactiveCodexAccounts: []
  }
}

// Why: a home that lets an account reach an old host would start it on that host's login (ORCA-798).
describe('remote member accounts across hosts (ORCA-798)', () => {
  let homeDb: OrchestrationDb
  let workerDb: OrchestrationDb
  let homeRuntime: OrcaRuntimeService
  let workerRuntime: OrcaRuntimeService
  let homeDispatcher: RpcDispatcher
  let workerCapabilities: string[]
  let attachParams: Record<string, unknown>[]

  beforeEach(() => {
    homeDb = new OrchestrationDb(':memory:')
    workerDb = new OrchestrationDb(':memory:')
    workerRuntime = new OrcaRuntimeService()
    workerRuntime.setOrchestrationDb(workerDb)
    configureWorkerRuntime(workerRuntime)
    vi.spyOn(workerRuntime, 'getAccountsSnapshot').mockReturnValue(WORKER_ACCOUNTS as never)
    const workerDispatcher = new RpcDispatcher({
      runtime: workerRuntime,
      methods: ORCHESTRATION_METHODS
    })
    workerCapabilities = [...(workerRuntime.getStatus().capabilities ?? [])]
    attachParams = []
    const transport: OrchestrationEnvironmentTransport = {
      resolve: () => ({
        environmentId: 'environment_imac',
        name: 'imac',
        peerFingerprint: 'imac_peer_fingerprint'
      }),
      call: async (_selector, method, params, _timeoutMs, envelope) => {
        if (method === 'status.get') {
          return {
            id: 'status',
            ok: true,
            result: {
              ...workerRuntime.getStatus(),
              capabilities: workerCapabilities
            },
            _meta: { runtimeId: workerRuntime.getRuntimeId() }
          }
        }
        if (method === 'orchestration.federationAttachStart') {
          attachParams.push({ ...(params as Record<string, unknown>) })
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
    homeDispatcher = new RpcDispatcher({
      runtime: homeRuntime,
      methods: ORCHESTRATION_METHODS
    })
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
      objective: 'Members on the iMac',
      coordinatorHandle: 'term_coord',
      coordinatorPaneKey: 'tab_coord:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
    })
    return homeDb.createTask({ spec: 'Member work', runId: run.id })
  }

  const claudeStart = (taskId: string, overrides: Record<string, unknown> = {}) =>
    startRequest(taskId, { agent: 'claude', game: true, ...overrides })

  it('advertises the member-account capability on a current build', () => {
    expect(workerRuntime.getStatus().capabilities).toContain(
      ORCHESTRATION_FEDERATION_MEMBER_ACCOUNT_RUNTIME_CAPABILITY
    )
  })

  it('pins a named account the remote resolves from its own roster', async () => {
    const task = createHomeTask()

    const response = await homeDispatcher.dispatch(
      claudeStart(task.id, { remoteAccount: 'ana@koombea.com' })
    )

    expect(response).toMatchObject({
      ok: true,
      result: {
        state: 'ready',
        account: { provider: 'claude', email: 'ana@koombea.com' }
      }
    })
    expect(attachParams[0]).toMatchObject({ account: 'ana@koombea.com' })
    expect(JSON.stringify(attachParams[0])).not.toContain('AccountId')
    expect(workerRuntime.createManagedWorktree).toHaveBeenCalledWith(
      expect.objectContaining({ claudeAccountId: 'imac-ana' })
    )
    expect(JSON.stringify(response)).not.toContain('imac-ana')
  })

  it('refuses an email the remote does not have and starts nothing there', async () => {
    const task = createHomeTask()

    const response = await homeDispatcher.dispatch(
      claudeStart(task.id, { remoteAccount: 'nobody@koombea.com' })
    )

    expect(response).toMatchObject({
      ok: true,
      result: { state: 'failed', refusal: { code: 'invalid_argument' } }
    })
    expect(JSON.stringify(response)).toContain('nobody@koombea.com is not a Claude account')
    expect(workerRuntime.createManagedWorktree).not.toHaveBeenCalled()
  })

  it('refuses an account for a remote older than member accounts by name', async () => {
    workerCapabilities = workerCapabilities.filter(
      (capability) => capability !== ORCHESTRATION_FEDERATION_MEMBER_ACCOUNT_RUNTIME_CAPABILITY
    )
    const task = createHomeTask()

    const response = await homeDispatcher.dispatch(
      claudeStart(task.id, { remoteAccount: 'ana@koombea.com' })
    )

    expect(response).toMatchObject({
      ok: false,
      error: { code: 'capability_unsupported' }
    })
    expect(JSON.stringify(response)).toContain(
      ORCHESTRATION_FEDERATION_MEMBER_ACCOUNT_RUNTIME_CAPABILITY
    )
    expect(attachParams).toHaveLength(0)
  })

  it('reports the email auto picked on the remote', async () => {
    const task = createHomeTask()

    const response = await homeDispatcher.dispatch(claudeStart(task.id, { remoteAccount: 'auto' }))

    expect(response).toMatchObject({
      ok: true,
      result: {
        state: 'ready',
        account: { provider: 'claude', email: 'ops@netsat.co' }
      }
    })
    expect(workerRuntime.createManagedWorktree).toHaveBeenCalledWith(
      expect.objectContaining({ claudeAccountId: 'imac-ops' })
    )
  })

  it('refuses a remote account without --on', async () => {
    const task = createHomeTask()

    const response = await homeDispatcher.dispatch(
      claudeStart(task.id, { on: undefined, remoteAccount: 'ana@koombea.com' })
    )

    expect(response).toMatchObject({
      ok: false,
      error: { code: 'invalid_argument' }
    })
  })

  it('still refuses a home account id with --on', async () => {
    const task = createHomeTask()

    const response = await homeDispatcher.dispatch(
      claudeStart(task.id, { claudeAccountId: 'home-ana' })
    )

    expect(response).toMatchObject({
      ok: false,
      error: { code: 'invalid_argument' }
    })
    expect(attachParams).toHaveLength(0)
  })
})
