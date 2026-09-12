import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  clearGlobalConfigForProviderAccount,
  previewGlobalConfigForProviderAccounts,
  resyncGlobalConfigForProviderAccounts,
  syncGlobalConfigForProviderAccount
} from './runtime-provider-global-config'
import {
  createCompatibleRuntimeStatusResponseIfNeeded,
  type RuntimeEnvironmentCallRequest
} from './runtime-compatibility-test-fixture'
import { clearRuntimeCompatibilityCacheForTests } from './runtime-rpc-client'

const LOCAL = { activeRuntimeEnvironmentId: null }
const REMOTE = { activeRuntimeEnvironmentId: 'env-1' }

const INVENTORY = { mcpServers: [{ name: 'context7' }], skills: ['orca-cli'], hooks: [] }
const SELECTION = {
  mcpServerNames: ['context7'],
  skillNames: ['orca-cli'],
  hookIds: [],
  writeGlobalHooks: true
}

const runtimeEnvironmentCall = vi.fn()
const runtimeEnvironmentTransportCall = vi.fn()
const previewLocal = vi.fn()
const syncAccountLocal = vi.fn()
const resyncLocal = vi.fn()
const clearLocal = vi.fn()

beforeEach(() => {
  clearRuntimeCompatibilityCacheForTests()
  for (const mock of [
    runtimeEnvironmentCall,
    runtimeEnvironmentTransportCall,
    previewLocal,
    syncAccountLocal,
    resyncLocal,
    clearLocal
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
        previewGlobalConfig: previewLocal,
        syncGlobalConfigForAccount: syncAccountLocal,
        resyncGlobalConfig: resyncLocal,
        clearGlobalConfigForAccount: clearLocal
      }
    }
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('global config reads', () => {
  it('offers the seed source of the host that owns the accounts, not this desktop', async () => {
    runtimeEnvironmentCall.mockResolvedValue({ id: 'r', ok: true, result: INVENTORY })

    await expect(previewGlobalConfigForProviderAccounts(REMOTE)).resolves.toEqual(INVENTORY)

    expect(runtimeEnvironmentCall).toHaveBeenCalledWith(
      expect.objectContaining({ method: 'accounts.previewGlobalConfig' })
    )
    expect(previewLocal).not.toHaveBeenCalled()
  })

  it('keeps the desktop lane on the local IPC', async () => {
    previewLocal.mockResolvedValue(INVENTORY)

    await expect(previewGlobalConfigForProviderAccounts(LOCAL)).resolves.toEqual(INVENTORY)

    expect(previewLocal).toHaveBeenCalledOnce()
    expect(runtimeEnvironmentCall).not.toHaveBeenCalled()
  })
})

describe('global config writes', () => {
  it('seeds one account on the host that owns it, not this desktop', async () => {
    runtimeEnvironmentCall.mockResolvedValue({ id: 'r', ok: true, result: { synced: true } })

    await syncGlobalConfigForProviderAccount(REMOTE, {
      accountId: 'acct-1',
      selection: SELECTION
    })

    expect(runtimeEnvironmentCall).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'accounts.syncGlobalConfigForAccount',
        params: { accountId: 'acct-1', selection: SELECTION }
      })
    )
    expect(syncAccountLocal).not.toHaveBeenCalled()
  })

  it('seeds the whole roster on the owner and reports its count', async () => {
    runtimeEnvironmentCall.mockResolvedValue({ id: 'r', ok: true, result: { processed: 3 } })

    await expect(
      resyncGlobalConfigForProviderAccounts(REMOTE, { selection: SELECTION })
    ).resolves.toBe(3)

    expect(runtimeEnvironmentCall).toHaveBeenCalledWith(
      expect.objectContaining({ method: 'accounts.resyncGlobalConfig' })
    )
    expect(resyncLocal).not.toHaveBeenCalled()
  })

  it('clears one account on the host that owns it, not this desktop', async () => {
    runtimeEnvironmentCall.mockResolvedValue({ id: 'r', ok: true, result: { cleared: true } })

    await clearGlobalConfigForProviderAccount(REMOTE, 'acct-1')

    expect(runtimeEnvironmentCall).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'accounts.clearGlobalConfigForAccount',
        params: { accountId: 'acct-1' }
      })
    )
    expect(clearLocal).not.toHaveBeenCalled()
  })

  it('keeps all three desktop lanes on the local IPC', async () => {
    syncAccountLocal.mockResolvedValue(undefined)
    resyncLocal.mockResolvedValue(2)
    clearLocal.mockResolvedValue(undefined)

    await syncGlobalConfigForProviderAccount(LOCAL, { accountId: 'acct-1', selection: SELECTION })
    await expect(resyncGlobalConfigForProviderAccounts(LOCAL, { selection: SELECTION })).resolves.toBe(2)
    await clearGlobalConfigForProviderAccount(LOCAL, 'acct-1')

    expect(syncAccountLocal).toHaveBeenCalledWith({ accountId: 'acct-1', selection: SELECTION })
    expect(resyncLocal).toHaveBeenCalledWith({ selection: SELECTION })
    expect(clearLocal).toHaveBeenCalledWith({ accountId: 'acct-1' })
    expect(runtimeEnvironmentCall).not.toHaveBeenCalled()
  })

  it('blames the server version when the host predates the methods', async () => {
    runtimeEnvironmentCall.mockResolvedValue({
      id: 'r',
      ok: false,
      error: { code: 'method_not_found', message: 'Unknown method: accounts.resyncGlobalConfig' }
    })

    await expect(resyncGlobalConfigForProviderAccounts(REMOTE)).rejects.toThrow(/server is too old/)
  })
})
