import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ClaudeRateLimitAccountsState } from '../../../shared/managed-account-types'
import {
  getClaudeCustomEndpointProviderConfig,
  updateClaudeCustomEndpointProviderAccount
} from './runtime-provider-custom-endpoint'
import {
  createCompatibleRuntimeStatusResponseIfNeeded,
  type RuntimeEnvironmentCallRequest
} from './runtime-compatibility-test-fixture'
import { clearRuntimeCompatibilityCacheForTests } from './runtime-rpc-client'

const LOCAL = { activeRuntimeEnvironmentId: null }
const REMOTE = { activeRuntimeEnvironmentId: 'env-1' }

const CONFIG = {
  label: 'z.ai · GLM',
  baseUrl: 'https://api.z.ai/api/anthropic',
  model: 'glm-5.1',
  opusModel: null,
  sonnetModel: null,
  haikuModel: null,
  subagentModel: null,
  hasToken: true
}

function emptyClaudeState(): ClaudeRateLimitAccountsState {
  return { accounts: [], activeAccountId: null, activeAccountIdsByRuntime: { host: null, wsl: {} } }
}

const runtimeEnvironmentCall = vi.fn()
const runtimeEnvironmentTransportCall = vi.fn()
const getCustomEndpointConfigLocal = vi.fn()
const updateCustomEndpointLocal = vi.fn()

beforeEach(() => {
  clearRuntimeCompatibilityCacheForTests()
  for (const mock of [
    runtimeEnvironmentCall,
    runtimeEnvironmentTransportCall,
    getCustomEndpointConfigLocal,
    updateCustomEndpointLocal
  ]) {
    mock.mockReset()
  }
  runtimeEnvironmentTransportCall.mockImplementation((args: RuntimeEnvironmentCallRequest) => {
    return createCompatibleRuntimeStatusResponseIfNeeded(args) ?? runtimeEnvironmentCall(args)
  })
  vi.stubGlobal('window', {
    setTimeout: globalThis.setTimeout.bind(globalThis),
    clearTimeout: globalThis.clearTimeout.bind(globalThis),
    api: {
      runtimeEnvironments: { call: runtimeEnvironmentTransportCall },
      claudeAccounts: {
        getCustomEndpointConfig: getCustomEndpointConfigLocal,
        updateCustomEndpoint: updateCustomEndpointLocal
      }
    }
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('custom endpoint read routing', () => {
  it('reads the endpoint from the server that owns the account, not this desktop', async () => {
    runtimeEnvironmentCall.mockResolvedValue({ id: 'r', ok: true, result: CONFIG })

    await expect(getClaudeCustomEndpointProviderConfig(REMOTE, 'acct-1')).resolves.toEqual(CONFIG)

    expect(runtimeEnvironmentCall).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'accounts.getCustomEndpointConfig',
        params: { accountId: 'acct-1' }
      })
    )
    expect(getCustomEndpointConfigLocal).not.toHaveBeenCalled()
  })

  it('keeps the desktop lane on the local IPC', async () => {
    getCustomEndpointConfigLocal.mockResolvedValue(CONFIG)

    await expect(getClaudeCustomEndpointProviderConfig(LOCAL, 'acct-1')).resolves.toEqual(CONFIG)

    expect(getCustomEndpointConfigLocal).toHaveBeenCalledWith({ accountId: 'acct-1' })
    expect(runtimeEnvironmentCall).not.toHaveBeenCalled()
  })

  it('blames the server version when the host predates the method', async () => {
    runtimeEnvironmentCall.mockResolvedValue({
      id: 'r',
      ok: false,
      error: { code: 'method_not_found', message: 'Unknown method: accounts.getCustomEndpointConfig' }
    })

    await expect(getClaudeCustomEndpointProviderConfig(REMOTE, 'acct-1')).rejects.toThrow(
      /server is too old/
    )
  })
})

describe('custom endpoint update routing', () => {
  const edit = {
    accountId: 'acct-1',
    label: 'z.ai · GLM',
    baseUrl: 'https://api.z.ai/api/anthropic',
    token: null,
    model: 'glm-5.1'
  }

  it('writes the edit to the server that owns the account, not this desktop', async () => {
    runtimeEnvironmentCall.mockResolvedValue({ id: 'r', ok: true, result: emptyClaudeState() })

    await expect(updateClaudeCustomEndpointProviderAccount(REMOTE, edit)).resolves.toEqual(
      emptyClaudeState()
    )

    expect(runtimeEnvironmentCall).toHaveBeenCalledWith(
      expect.objectContaining({ method: 'accounts.updateCustomEndpoint', params: edit })
    )
    expect(updateCustomEndpointLocal).not.toHaveBeenCalled()
  })

  it('keeps the desktop lane on the local IPC', async () => {
    updateCustomEndpointLocal.mockResolvedValue(emptyClaudeState())

    await expect(updateClaudeCustomEndpointProviderAccount(LOCAL, edit)).resolves.toEqual(
      emptyClaudeState()
    )

    expect(updateCustomEndpointLocal).toHaveBeenCalledWith(edit)
    expect(runtimeEnvironmentCall).not.toHaveBeenCalled()
  })
})
