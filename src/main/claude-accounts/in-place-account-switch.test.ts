import { describe, expect, it, vi } from 'vitest'
import {
  abortInPlaceClaudeAccountSwitch,
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

function sourcePreparation() {
  return {
    ...preparation(),
    configDir: '/vaults/account-a/auth',
    envPatch: { CLAUDE_CONFIG_DIR: '/vaults/account-a/auth' },
    injectedAccountId: 'account-a',
    injectedAccountReservationId: 'reservation-a',
    provenance: 'managed:account-a:injected'
  }
}

describe('abortInPlaceClaudeAccountSwitch', () => {
  it('re-attributes the PTY to the source account and returns its config dir', async () => {
    const restoreBinding = vi.fn()
    const releaseReservation = vi.fn()

    const result = await abortInPlaceClaudeAccountSwitch(
      { ptyId: 'pty-abort-1', sourceAccountId: 'account-a', reservationId: 'reservation-b' },
      {
        // Why null: begin already released it, which is exactly the state this repairs.
        getCurrentAccountId: () => null,
        prepareSource: async () => sourcePreparation(),
        restoreBinding,
        releaseReservation
      }
    )

    expect(result).toEqual({ ok: true, configDir: '/vaults/account-a/auth' })
    expect(restoreBinding).toHaveBeenCalledWith('pty-abort-1', 'account-a', 'reservation-a')
    expect(releaseReservation).toHaveBeenCalledWith('reservation-b')
  })

  it('still returns the source config dir when the binding was never released', async () => {
    const restoreBinding = vi.fn()

    const result = await abortInPlaceClaudeAccountSwitch(
      { ptyId: 'pty-abort-2', sourceAccountId: 'account-a', reservationId: 'reservation-b' },
      {
        getCurrentAccountId: () => 'account-a',
        prepareSource: async () => sourcePreparation(),
        restoreBinding,
        releaseReservation: vi.fn()
      }
    )

    expect(result).toEqual({ ok: true, configDir: '/vaults/account-a/auth' })
    // Why re-mark anyway: the exited CLI's refresh-chain claim has to move to the new one.
    expect(restoreBinding).toHaveBeenCalledWith('pty-abort-2', 'account-a', 'reservation-a')
  })

  it('refuses a PTY that now belongs to a third account', async () => {
    const restoreBinding = vi.fn()
    const prepareSource = vi.fn()

    const result = await abortInPlaceClaudeAccountSwitch(
      { ptyId: 'pty-abort-3', sourceAccountId: 'account-a', reservationId: 'reservation-b' },
      {
        getCurrentAccountId: () => 'account-c',
        prepareSource,
        restoreBinding,
        releaseReservation: vi.fn()
      }
    )

    expect(result).toEqual({ ok: false, reason: 'foreign-binding' })
    expect(prepareSource).not.toHaveBeenCalled()
    expect(restoreBinding).not.toHaveBeenCalled()
  })

  it('releases the source reservation when the binding cannot be restored', async () => {
    const releaseReservation = vi.fn()

    const result = await abortInPlaceClaudeAccountSwitch(
      { ptyId: 'pty-abort-4', sourceAccountId: 'account-a', reservationId: 'reservation-b' },
      {
        getCurrentAccountId: () => null,
        prepareSource: async () => sourcePreparation(),
        restoreBinding: () => {
          throw new Error('A live Claude terminal cannot change its assigned account.')
        },
        releaseReservation
      }
    )

    expect(result).toEqual({ ok: false, reason: 'prepare-failed' })
    expect(releaseReservation).toHaveBeenCalledWith('reservation-a')
  })

  it('frees the per-PTY switch lock so the terminal can be switched again', async () => {
    const begun = await beginInPlaceClaudeAccountSwitch(
      {
        ptyId: 'pty-abort-5',
        sourceAccountId: 'account-a',
        targetAccountId: 'account-b',
        runtime: 'host',
        wslDistro: null
      },
      {
        getCurrentAccountId: () => 'account-a',
        inspectProcess: async () => ({ foregroundProcess: 'zsh', hasChildProcesses: false }),
        prepareTarget: async () => preparation(),
        releaseCurrentBinding: () => true,
        releaseReservation: vi.fn()
      }
    )
    expect(begun).toMatchObject({ ok: true })

    await abortInPlaceClaudeAccountSwitch(
      { ptyId: 'pty-abort-5', sourceAccountId: 'account-a', reservationId: 'reservation-b' },
      {
        getCurrentAccountId: () => null,
        prepareSource: async () => sourcePreparation(),
        restoreBinding: vi.fn(),
        releaseReservation: vi.fn()
      }
    )

    const again = await beginInPlaceClaudeAccountSwitch(
      {
        ptyId: 'pty-abort-5',
        sourceAccountId: 'account-a',
        targetAccountId: 'account-b',
        runtime: 'host',
        wslDistro: null
      },
      {
        getCurrentAccountId: () => 'account-a',
        inspectProcess: async () => ({ foregroundProcess: 'zsh', hasChildProcesses: false }),
        prepareTarget: async () => preparation(),
        releaseCurrentBinding: () => true,
        releaseReservation: vi.fn()
      }
    )

    expect(again).toMatchObject({ ok: true })
    finishInPlaceClaudeAccountSwitch('pty-abort-5', 'reservation-b')
  })
})
