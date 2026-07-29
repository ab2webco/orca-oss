import { describe, expect, it, vi } from 'vitest'
import {
  beginInPlaceClaudeAccountSwitch,
  finishInPlaceClaudeAccountSwitch
} from './in-place-account-switch'

function preparation() {
  return {
    configDir: '/vaults/account-b/auth',
    runtime: 'host' as const,
    wslDistro: null,
    wslLinuxConfigDir: null,
    envPatch: { CLAUDE_CONFIG_DIR: '/vaults/account-b/auth' },
    stripAuthEnv: true,
    injectedAccountId: 'account-b',
    injectedAccountReservationId: 'reservation-b',
    provenance: 'managed:account-b:injected'
  }
}

describe('beginInPlaceClaudeAccountSwitch', () => {
  it('prepares the destination before releasing the exited foreground CLI binding', async () => {
    const order: string[] = []
    const releaseCurrentBinding = vi.fn(() => {
      order.push('release')
      return true
    })

    const result = await beginInPlaceClaudeAccountSwitch(
      {
        ptyId: 'pty-1',
        sourceAccountId: 'account-a',
        targetAccountId: 'account-b',
        runtime: 'host',
        wslDistro: null
      },
      {
        getCurrentAccountId: () => 'account-a',
        inspectProcess: async () => ({
          foregroundProcess: 'zsh',
          hasChildProcesses: false
        }),
        prepareTarget: async () => {
          order.push('prepare')
          return preparation()
        },
        releaseCurrentBinding,
        releaseReservation: vi.fn()
      }
    )

    expect(result).toEqual({
      ok: true,
      configDir: '/vaults/account-b/auth',
      reservationId: 'reservation-b',
      shell: 'posix'
    })
    expect(order).toEqual(['prepare', 'release'])
    finishInPlaceClaudeAccountSwitch('pty-1', 'reservation-b')
  })

  it('re-inspects after preparation and releases the reservation when Claude returns to foreground', async () => {
    const releaseCurrentBinding = vi.fn(() => true)
    const prepareTarget = vi.fn(async () => preparation())
    const releaseReservation = vi.fn()

    const result = await beginInPlaceClaudeAccountSwitch(
      {
        ptyId: 'pty-1',
        sourceAccountId: 'account-a',
        targetAccountId: 'account-b',
        runtime: 'host',
        wslDistro: null
      },
      {
        getCurrentAccountId: () => 'account-a',
        inspectProcess: async () => ({
          foregroundProcess: 'claude',
          hasChildProcesses: true
        }),
        prepareTarget,
        releaseCurrentBinding,
        releaseReservation
      }
    )

    expect(result).toEqual({ ok: false, reason: 'unhealthy' })
    expect(prepareTarget).toHaveBeenCalledTimes(1)
    expect(releaseCurrentBinding).not.toHaveBeenCalled()
    expect(releaseReservation).toHaveBeenCalledWith('reservation-b')
  })

  it('rejects a shell that still has foreground child processes after preparation', async () => {
    const releaseReservation = vi.fn()

    const result = await beginInPlaceClaudeAccountSwitch(
      {
        ptyId: 'pty-children',
        sourceAccountId: 'account-a',
        targetAccountId: 'account-b',
        runtime: 'host',
        wslDistro: null
      },
      {
        getCurrentAccountId: () => 'account-a',
        inspectProcess: async () => ({
          foregroundProcess: 'zsh',
          hasChildProcesses: true
        }),
        prepareTarget: async () => preparation(),
        releaseCurrentBinding: vi.fn(() => true),
        releaseReservation
      }
    )

    expect(result).toEqual({ ok: false, reason: 'unhealthy' })
    expect(releaseReservation).toHaveBeenCalledWith('reservation-b')
  })

  it('cancels destination ownership if releasing the expected source loses a race', async () => {
    const releaseReservation = vi.fn()

    const result = await beginInPlaceClaudeAccountSwitch(
      {
        ptyId: 'pty-1',
        sourceAccountId: 'account-a',
        targetAccountId: 'account-b',
        runtime: 'host',
        wslDistro: null
      },
      {
        getCurrentAccountId: () => 'account-a',
        inspectProcess: async () => ({
          foregroundProcess: 'zsh',
          hasChildProcesses: false
        }),
        prepareTarget: async () => preparation(),
        releaseCurrentBinding: () => false,
        releaseReservation
      }
    )

    expect(result).toEqual({ ok: false, reason: 'source-mismatch' })
    expect(releaseReservation).toHaveBeenCalledWith('reservation-b')
  })

  it('serializes switches for the same PTY while destination preparation is pending', async () => {
    let resolvePreparation: ((value: ReturnType<typeof preparation>) => void) | undefined
    const pendingPreparation = new Promise<ReturnType<typeof preparation>>((resolve) => {
      resolvePreparation = resolve
    })
    const deps = {
      getCurrentAccountId: () => 'account-a',
      inspectProcess: async () => ({ foregroundProcess: 'zsh', hasChildProcesses: false }),
      prepareTarget: vi.fn(() => pendingPreparation),
      releaseCurrentBinding: vi.fn(() => true),
      releaseReservation: vi.fn()
    }
    const args = {
      ptyId: 'pty-lock',
      sourceAccountId: 'account-a',
      targetAccountId: 'account-b',
      runtime: 'host' as const,
      wslDistro: null
    }

    const first = beginInPlaceClaudeAccountSwitch(args, deps)
    const second = await beginInPlaceClaudeAccountSwitch(args, deps)

    expect(second).toEqual({ ok: false, reason: 'concurrent' })
    expect(deps.prepareTarget).toHaveBeenCalledTimes(1)
    resolvePreparation?.(preparation())
    await expect(first).resolves.toMatchObject({ ok: true })
    finishInPlaceClaudeAccountSwitch('pty-lock', 'reservation-b')
  })

  it.each([
    ['cmd.exe', 'cmd'],
    ['powershell.exe', 'powershell'],
    ['C:\\Program Files\\Git\\bin\\bash.exe', 'posix']
  ] as const)('returns the authoritative Windows shell family for %s', async (process, shell) => {
    const result = await beginInPlaceClaudeAccountSwitch(
      {
        ptyId: `pty-${shell}`,
        sourceAccountId: 'account-a',
        targetAccountId: 'account-b',
        runtime: 'host',
        wslDistro: null
      },
      {
        getCurrentAccountId: () => 'account-a',
        inspectProcess: async () => ({ foregroundProcess: process, hasChildProcesses: false }),
        prepareTarget: async () => preparation(),
        releaseCurrentBinding: () => true,
        releaseReservation: vi.fn()
      }
    )

    expect(result).toMatchObject({ ok: true, shell })
    finishInPlaceClaudeAccountSwitch(`pty-${shell}`, 'reservation-b')
  })
})
