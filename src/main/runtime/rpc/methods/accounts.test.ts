import { describe, expect, it, vi } from 'vitest'
import type { OrcaRuntimeService } from '../../orca-runtime'
import { isStreamingMethod } from '../core'
import { ACCOUNT_METHODS } from './accounts'

function method(name: string) {
  const found = ACCOUNT_METHODS.find((candidate) => candidate.name === name)
  if (!found) {
    throw new Error(`Missing method ${name}`)
  }
  return found
}

describe('account RPC methods', () => {
  it('returns the exact managed owner recorded for a runtime PTY', async () => {
    const getManagedPtyAccountOwner = vi.fn(() => ({
      known: true,
      accountId: 'codex-account',
      customEndpoint: false
    }))
    const runtime = { getManagedPtyAccountOwner } as unknown as OrcaRuntimeService
    const owner = method('accounts.getPtyOwner')
    if (isStreamingMethod(owner)) {
      throw new Error('accounts.getPtyOwner must be a request method')
    }

    await expect(owner.handler({ ptyId: 'pty-1', agent: 'codex' }, { runtime })).resolves.toEqual({
      known: true,
      accountId: 'codex-account',
      customEndpoint: false
    })
    expect(getManagedPtyAccountOwner).toHaveBeenCalledWith('pty-1', 'codex')
  })

  it('keeps explicit account-list refreshes on the forced refresh lane', async () => {
    const snapshot = { claude: null, codex: null }
    const runtime = {
      refreshAccountsForMobile: vi.fn().mockResolvedValue(undefined),
      getAccountsSnapshot: vi.fn(() => snapshot)
    } as unknown as OrcaRuntimeService
    const list = method('accounts.list')
    if (isStreamingMethod(list)) {
      throw new Error('accounts.list must be a request method')
    }

    await expect(list.handler(undefined, { runtime })).resolves.toBe(snapshot)
    expect(runtime.refreshAccountsForMobile).toHaveBeenCalledOnce()
  })

  it('serves accounts.snapshot from the cache without a provider refresh', async () => {
    const snapshot = { claude: null, codex: null }
    const runtime = {
      refreshAccountsForMobile: vi.fn().mockResolvedValue(undefined),
      getAccountsSnapshot: vi.fn(() => snapshot)
    } as unknown as OrcaRuntimeService
    const snapshotMethod = method('accounts.snapshot')
    if (isStreamingMethod(snapshotMethod)) {
      throw new Error('accounts.snapshot must be a request method')
    }

    await expect(snapshotMethod.handler(undefined, { runtime })).resolves.toBe(snapshot)
    expect(runtime.refreshAccountsForMobile).not.toHaveBeenCalled()
  })

  it('forwards a client idempotency key when consuming a Codex reset credit', async () => {
    const idempotencyKey = '11111111-1111-4111-8111-111111111111'
    const expectedScope = {
      target: { runtime: 'host' as const, wslDistro: null },
      accountId: 'codex-account',
      accountRevision: 42,
      offerRevision: 'v1:offer'
    }
    const result = {
      outcome: 'reset',
      scope: expectedScope,
      snapshot: { claude: null, codex: null }
    }
    const consumeCodexRateLimitResetCredit = vi.fn().mockResolvedValue(result)
    const runtime = { consumeCodexRateLimitResetCredit } as unknown as OrcaRuntimeService
    const reset = method('accounts.consumeCodexResetCredit')
    if (isStreamingMethod(reset)) {
      throw new Error('accounts.consumeCodexResetCredit must be a request method')
    }

    expect(reset.params?.parse({ idempotencyKey, expectedScope })).toEqual({
      idempotencyKey,
      expectedScope
    })
    expect(() => reset.params?.parse({ idempotencyKey: 'not-a-uuid', expectedScope })).toThrow()
    expect(() =>
      reset.params?.parse({
        idempotencyKey,
        expectedScope: {
          ...expectedScope,
          target: { runtime: 'host', wslDistro: 'Ubuntu' }
        }
      })
    ).toThrow()
    expect(() =>
      reset.params?.parse({
        idempotencyKey,
        expectedScope: {
          ...expectedScope,
          target: { runtime: 'wsl', wslDistro: null }
        }
      })
    ).toThrow()
    expect(() => reset.params?.parse({ idempotencyKey, expectedScope, extra: true })).toThrow()
    await expect(reset.handler({ idempotencyKey, expectedScope }, { runtime })).resolves.toBe(
      result
    )
    expect(consumeCodexRateLimitResetCredit).toHaveBeenCalledWith(idempotencyKey, expectedScope)
  })

  it('forwards the exact WSL target when selecting a Codex account', async () => {
    const selectCodexAccountForTarget = vi
      .fn()
      .mockResolvedValue({ accounts: [], activeAccountId: null })
    const runtime = { selectCodexAccountForTarget } as unknown as OrcaRuntimeService
    const select = method('accounts.selectCodexForTarget')
    if (isStreamingMethod(select)) {
      throw new Error('accounts.selectCodexForTarget must be a request method')
    }
    const params = {
      accountId: null,
      target: { runtime: 'wsl' as const, wslDistro: 'Ubuntu' }
    }

    expect(select.params?.parse(params)).toEqual(params)
    expect(
      select.params?.parse({
        accountId: null,
        target: { runtime: 'wsl', wslDistro: null }
      })
    ).toEqual({ accountId: null, target: { runtime: 'wsl', wslDistro: null } })
    expect(() =>
      select.params?.parse({
        accountId: null,
        target: { runtime: 'host', wslDistro: 'Ubuntu' }
      })
    ).toThrow()
    expect(() =>
      select.params?.parse({
        accountId: null,
        target: { runtime: 'wsl', wslDistro: '   ' }
      })
    ).toThrow()
    await expect(select.handler(params, { runtime })).resolves.toEqual({
      accounts: [],
      activeAccountId: null
    })
    expect(selectCodexAccountForTarget).toHaveBeenCalledWith(null, params.target)
  })

  it('uses a stale-aware refresh when a connection replays the subscription', async () => {
    const snapshot = { claude: null, codex: null }
    let cleanup: (() => void) | undefined
    const runtime = {
      getAccountsSnapshot: vi.fn(() => snapshot),
      onAccountsChanged: vi.fn(() => vi.fn()),
      registerSubscriptionCleanup: vi.fn((_id: string, nextCleanup: () => void) => {
        cleanup = nextCleanup
      }),
      refreshAccountsForMobile: vi.fn().mockResolvedValue(undefined),
      refreshAccountsForMobileSubscriber: vi.fn().mockResolvedValue(undefined)
    } as unknown as OrcaRuntimeService
    const subscribe = method('accounts.subscribe')
    if (!isStreamingMethod(subscribe)) {
      throw new Error('accounts.subscribe must be a streaming method')
    }
    const emit = vi.fn()

    const running = subscribe.handler(undefined, { runtime, connectionId: 'connection-1' }, emit)
    await vi.waitFor(() => {
      expect(runtime.refreshAccountsForMobileSubscriber).toHaveBeenCalledOnce()
    })

    expect(runtime.refreshAccountsForMobile).not.toHaveBeenCalled()
    expect(emit).toHaveBeenCalledWith(expect.objectContaining({ type: 'ready', snapshot }))
    cleanup?.()
    await running
  })
})
