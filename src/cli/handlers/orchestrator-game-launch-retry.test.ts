import { describe, expect, it } from 'vitest'
import { callWithLaunchRetry, isLaunchRefusal } from './orchestrator-game-launch-retry'
import { RuntimeClientError } from '../runtime-client'

const unavailable = (requestId?: string) =>
  new RuntimeClientError(
    'runtime_unavailable',
    'Orca Lab did not answer.',
    requestId ? { orchestrationRequestId: requestId } : undefined
  )

describe('callWithLaunchRetry', () => {
  it('retries a network failure with the same request id, so the runtime runs it at most once', async () => {
    const ids: (string | undefined)[] = []
    const result = await callWithLaunchRetry(
      async (requestId) => {
        ids.push(requestId)
        if (ids.length < 3) {
          throw unavailable('rq1')
        }
        return 'started'
      },
      [0, 0]
    )
    expect(result).toBe('started')
    expect(ids).toEqual([undefined, 'rq1', 'rq1'])
  })

  it('gives up after the bounded attempts with the last error', async () => {
    let attempts = 0
    await expect(
      callWithLaunchRetry(async () => {
        attempts += 1
        throw unavailable('rq1')
      }, [0, 0])
    ).rejects.toThrow('Orca Lab did not answer.')
    expect(attempts).toBe(3)
  })

  it('never retries a refusal, nor a failure it cannot retry idempotently', async () => {
    for (const error of [new RuntimeClientError('invalid_argument', 'bad'), unavailable()]) {
      let attempts = 0
      await expect(
        callWithLaunchRetry(async () => {
          attempts += 1
          throw error
        }, [0, 0])
      ).rejects.toBe(error)
      expect(attempts).toBe(1)
    }
  })
})

describe('isLaunchRefusal', () => {
  it('reads an answer from the runtime as a refusal, and a lost call as unknown', () => {
    expect(isLaunchRefusal(new RuntimeClientError('invalid_argument', 'no'))).toBe(true)
    expect(isLaunchRefusal(unavailable('rq1'))).toBe(false)
    expect(isLaunchRefusal(new RuntimeClientError('runtime_timeout', 'slow'))).toBe(false)
    expect(isLaunchRefusal(new Error('bug'))).toBe(false)
  })
})
