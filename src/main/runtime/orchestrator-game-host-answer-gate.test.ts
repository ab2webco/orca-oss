import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { GameHostAnswerGate, GameHostUnansweredError } from './orchestrator-game-host-answer-gate'

const never = <T>(): Promise<T> => new Promise<T>(() => {})

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe('GameHostAnswerGate', () => {
  it("hands back the host's answer when it comes before the deadline", async () => {
    const gate = new GameHostAnswerGate({ downForMs: 30_000 })

    await expect(gate.call('env_m1', async () => 'answer', 4_000)).resolves.toBe('answer')
  })

  // Why: a call's own timeout starts only once the host's queue runs it, so it cannot bound the wait.
  it('gives up at the deadline even when the read never starts', async () => {
    const gate = new GameHostAnswerGate({ downForMs: 30_000 })
    const result = gate.call('env_imac', never, 4_000).catch((error: unknown) => error)

    await vi.advanceTimersByTimeAsync(3_999)
    const early = await Promise.race([result, Promise.resolve('pending')])
    expect(early).toBe('pending')

    await vi.advanceTimersByTimeAsync(1)
    expect(await result).toBeInstanceOf(GameHostUnansweredError)
  })

  it('skips a host that did not answer for the down window, without calling it, and not another', async () => {
    const gate = new GameHostAnswerGate({ downForMs: 30_000 })
    const first = gate.call('env_imac', never, 4_000).catch(() => null)
    await vi.advanceTimersByTimeAsync(4_000)
    await first

    const again = vi.fn(async () => 'late')
    await expect(gate.call('env_imac', again, 4_000)).rejects.toBeInstanceOf(
      GameHostUnansweredError
    )
    expect(again).not.toHaveBeenCalled()
    await expect(gate.call('env_m1', async () => 'm1', 4_000)).resolves.toBe('m1')

    await vi.advanceTimersByTimeAsync(30_000)
    await expect(gate.call('env_imac', again, 4_000)).resolves.toBe('late')
    expect(again).toHaveBeenCalledTimes(1)
  })

  // Why: a full `ps` sweep can run long on a loaded host that still answers its light reads.
  it('lets a slow sweep give up at its deadline without marking a live host silent', async () => {
    const gate = new GameHostAnswerGate({ downForMs: 30_000 })
    const sweep = gate.call('env_m1', never, 7_000, { marksSilence: false }).catch((e) => e)
    await vi.advanceTimersByTimeAsync(7_000)
    expect(await sweep).toBeInstanceOf(GameHostUnansweredError)

    const show = vi.fn(async () => 'shown')
    await expect(gate.call('env_m1', show, 4_000)).resolves.toBe('shown')
    expect(show).toHaveBeenCalledTimes(1)
  })

  it('skips a silent host for a sweep too', async () => {
    const gate = new GameHostAnswerGate({ downForMs: 30_000 })
    const first = gate.call('env_imac', never, 4_000).catch(() => null)
    await vi.advanceTimersByTimeAsync(4_000)
    await first

    const sweep = vi.fn(async () => 'swept')
    await expect(
      gate.call('env_imac', sweep, 7_000, { marksSilence: false })
    ).rejects.toBeInstanceOf(GameHostUnansweredError)
    expect(sweep).not.toHaveBeenCalled()
  })

  it('does not skip a host that answered with an error', async () => {
    const gate = new GameHostAnswerGate({ downForMs: 30_000 })
    await expect(
      gate.call(
        'env_m1',
        async () => {
          throw new Error('dispatch_not_found')
        },
        4_000
      )
    ).rejects.toThrow('dispatch_not_found')

    const next = vi.fn(async () => 'ok')
    await expect(gate.call('env_m1', next, 4_000)).resolves.toBe('ok')
    expect(next).toHaveBeenCalledTimes(1)
  })

  it('treats a read that times out on its own as no answer', async () => {
    const gate = new GameHostAnswerGate({ downForMs: 30_000 })
    await expect(
      gate.call(
        'env_imac',
        async () => {
          throw Object.assign(new Error('Timed out waiting for the remote Orca runtime'), {
            code: 'runtime_timeout'
          })
        },
        4_000
      )
    ).rejects.toThrow('Timed out')

    const next = vi.fn(async () => 'ok')
    await expect(gate.call('env_imac', next, 4_000)).rejects.toBeInstanceOf(GameHostUnansweredError)
    expect(next).not.toHaveBeenCalled()
  })
})
