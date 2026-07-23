import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  closeLiveClaudeTerminalsForAccount,
  getLiveClaudePtyIdsForAccount
} from './close-live-claude-terminals'
import {
  hasLiveInjectedClaudePtysForAccount,
  hasLiveSharedClaudePtysForAccount,
  markClaudePtyExited,
  markClaudePtySpawned,
  markInjectedClaudePtySpawned
} from './live-pty-gate'

const PTY_IDS = ['injected-a', 'injected-other', 'shared-a', 'shared-null'] as const

describe('closeLiveClaudeTerminalsForAccount', () => {
  afterEach(() => {
    for (const ptyId of PTY_IDS) {
      markClaudePtyExited(ptyId)
    }
  })

  it('terminates injected and account/unknown-owned shared PTYs, then clears the gate', async () => {
    markInjectedClaudePtySpawned('injected-a', 'account-a')
    markInjectedClaudePtySpawned('injected-other', 'account-b')
    markClaudePtySpawned('shared-a', 'account-a')
    markClaudePtySpawned('shared-null', null)

    const terminate = vi.fn(async (_ptyId: string) => true)
    await closeLiveClaudeTerminalsForAccount('account-a', terminate)

    const killed = terminate.mock.calls.map((call) => call[0]).sort()
    expect(killed).toEqual(['injected-a', 'shared-a', 'shared-null'])
    expect(terminate).not.toHaveBeenCalledWith('injected-other')
    expect(hasLiveInjectedClaudePtysForAccount('account-a')).toBe(false)
    expect(hasLiveSharedClaudePtysForAccount('account-a')).toBe(false)
    // Why: an unrelated account's terminal must survive the close.
    expect(hasLiveInjectedClaudePtysForAccount('account-b')).toBe(true)
  })

  it('throws and leaves the gate closed when a PTY cannot be terminated', async () => {
    markInjectedClaudePtySpawned('injected-a', 'account-a')
    const terminate = vi.fn(async (_ptyId: string) => false)

    await expect(closeLiveClaudeTerminalsForAccount('account-a', terminate)).rejects.toThrow(
      'could not be closed'
    )
    expect(hasLiveInjectedClaudePtysForAccount('account-a')).toBe(true)
  })

  it('is a no-op when the account has no live terminals', async () => {
    const terminate = vi.fn(async (_ptyId: string) => true)
    await expect(
      closeLiveClaudeTerminalsForAccount('account-a', terminate)
    ).resolves.toBeUndefined()
    expect(terminate).not.toHaveBeenCalled()
  })
})

describe('getLiveClaudePtyIdsForAccount', () => {
  afterEach(() => {
    for (const ptyId of PTY_IDS) {
      markClaudePtyExited(ptyId)
    }
  })

  it('lists injected + account/unknown-owned shared PTYs, never another account', () => {
    markInjectedClaudePtySpawned('injected-a', 'account-a')
    markClaudePtySpawned('shared-a', 'account-a')
    markClaudePtySpawned('shared-null', null)
    markInjectedClaudePtySpawned('injected-other', 'account-b')

    expect(getLiveClaudePtyIdsForAccount('account-a').sort()).toEqual([
      'injected-a',
      'shared-a',
      'shared-null'
    ])
    expect(getLiveClaudePtyIdsForAccount('account-b').sort()).toEqual([
      'injected-other',
      'shared-null'
    ])
  })
})
