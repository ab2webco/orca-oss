// @vitest-environment happy-dom
// The switch menu listed THIS desktop's accounts for a server-hosted pane. The
// emails matched, so the menu looked right; the ids did not, and the switch died
// on "No managed Claude account matches that selector". Measured on the real
// hosts: fabiana@koombea.com is 1e7aefc6 here and 4114a81e on orca-contabo.
//
// The roster was keyed on the app's ACTIVE runtime, which is routinely null
// while the pane's owner is a server. These cases pin it to the pane's owner.
import { act, renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { toRemoteRuntimePtyId } from '@/runtime/runtime-terminal-stream'
import { useClaudeAccountSwitchTargets } from './ClaudeAccountSwitchList'
import { resolvePaneOwnerEnvironmentId } from './pane-owner-environment'
import type { PtyTransport } from './pty-transport'

const callRuntimeRpc = vi.hoisted(() => vi.fn())

vi.mock('@/runtime/runtime-rpc-client', () => ({
  callRuntimeRpc,
  getActiveRuntimeTarget: (settings: { activeRuntimeEnvironmentId?: string | null }) =>
    settings.activeRuntimeEnvironmentId
      ? { kind: 'environment', environmentId: settings.activeRuntimeEnvironmentId }
      : { kind: 'local' }
}))
vi.mock('@/i18n/i18n', () => ({ translate: (_k: string, f: string) => f }))
vi.mock('./use-manual-claude-account-switch', () => ({ claudeAccountSwitchLabel: () => '' }))

const DESKTOP = {
  accounts: [{ id: '1e7aefc6', email: 'fabiana@koombea.com' }],
  activeAccountId: '1e7aefc6'
}
const SERVER = {
  accounts: [{ id: '4114a81e', email: 'fabiana@koombea.com' }],
  activeAccountId: '4114a81e'
}

function stubLocal(): ReturnType<typeof vi.fn> {
  const list = vi.fn().mockResolvedValue(DESKTOP)
  Object.defineProperty(window, 'api', {
    value: { claudeAccounts: { list } },
    configurable: true,
    writable: true
  })
  return list
}

function fakeTransports(entries: [number, string][]): Map<number, PtyTransport> {
  const map = new Map<number, PtyTransport>()
  for (const [paneId, ptyId] of entries) {
    map.set(paneId, { getPtyId: () => ptyId } as unknown as PtyTransport)
  }
  return map
}

describe('pane owner -> roster', () => {
  it('REMOTE pane: reads the owning server roster, not the desktop', async () => {
    callRuntimeRpc.mockReset().mockResolvedValue({ claude: SERVER })
    const local = stubLocal()
    const { result } = renderHook(() => useClaudeAccountSwitchTargets(true, 'env-server'))
    await waitFor(() => expect(result.current.oauthAccounts).toHaveLength(1))
    expect(result.current.oauthAccounts[0]?.id).toBe('4114a81e')
    expect(result.current.activeAccountId).toBe('4114a81e')
    expect(callRuntimeRpc).toHaveBeenCalledWith(
      { kind: 'environment', environmentId: 'env-server' },
      'accounts.list',
      { refreshUsage: false },
      expect.anything()
    )
    expect(local).not.toHaveBeenCalled()
  })

  it('LOCAL pane: unchanged — still reads this desktop over the preload', async () => {
    callRuntimeRpc.mockReset()
    const local = stubLocal()
    const { result } = renderHook(() => useClaudeAccountSwitchTargets(true, null))
    await waitFor(() => expect(result.current.oauthAccounts).toHaveLength(1))
    expect(result.current.oauthAccounts[0]?.id).toBe('1e7aefc6')
    expect(local).toHaveBeenCalledTimes(1)
    expect(callRuntimeRpc).not.toHaveBeenCalled()
  })

  it('never shows the previous host list while the new one is in flight', async () => {
    let release: ((v: unknown) => void) | null = null
    callRuntimeRpc.mockReset().mockImplementation(
      () =>
        new Promise((resolve) => {
          release = resolve
        })
    )
    stubLocal()
    const { result, rerender } = renderHook(
      ({ env }: { env: string | null }) => useClaudeAccountSwitchTargets(true, env),
      { initialProps: { env: null as string | null } }
    )
    await waitFor(() => expect(result.current.oauthAccounts).toHaveLength(1))
    expect(result.current.oauthAccounts[0]?.id).toBe('1e7aefc6')

    rerender({ env: 'env-server' })
    // The desktop list must be gone the moment the owner changes.
    expect(result.current.oauthAccounts).toHaveLength(0)
    expect(result.current.activeAccountId).toBeNull()

    await act(async () => {
      release?.({ claude: SERVER })
      await Promise.resolve()
    })
    await waitFor(() => expect(result.current.oauthAccounts[0]?.id).toBe('4114a81e'))
  })

  it('does not blink empty when the same menu reopens over the same owner', async () => {
    callRuntimeRpc.mockReset()
    stubLocal()
    const { result, rerender } = renderHook(
      ({ on }: { on: boolean }) => useClaudeAccountSwitchTargets(on, null),
      { initialProps: { on: true } }
    )
    await waitFor(() => expect(result.current.oauthAccounts).toHaveLength(1))
    rerender({ on: false })
    rerender({ on: true })
    // Same owner: the already-fetched list must stay on screen.
    expect(result.current.oauthAccounts).toHaveLength(1)
    expect(result.current.activeAccountId).toBe('1e7aefc6')
  })

  it('derives the owner from the pane transport ptyId', () => {
    const transports = fakeTransports([
      [1, toRemoteRuntimePtyId('terminal:a', 'env-server')],
      [2, 'pty-local-9']
    ])
    expect(resolvePaneOwnerEnvironmentId(transports, 1)).toBe('env-server')
    expect(resolvePaneOwnerEnvironmentId(transports, 2)).toBeNull()
    expect(resolvePaneOwnerEnvironmentId(transports, 99)).toBeNull()
    expect(resolvePaneOwnerEnvironmentId(transports, null)).toBeNull()
  })
})
