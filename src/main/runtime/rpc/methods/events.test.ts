import { describe, expect, it, vi } from 'vitest'
import type { OrcaEvent, OrcaEventFilter } from '../../../../shared/orca-events'
import type { OrcaRuntimeService } from '../../orca-runtime'
import { isStreamingMethod, type RpcContext, type RpcStreamingMethod } from '../core'
import { ALL_RPC_METHODS } from './index'

const subscribeMethod = ALL_RPC_METHODS.find(
  (method) => method.name === 'events.subscribe' && isStreamingMethod(method)
) as RpcStreamingMethod

const agentEvent: OrcaEvent = {
  name: 'agent.status.changed',
  at: 1,
  worktreeId: 'wt-1',
  terminal: 'term_a',
  payload: { paneKey: 'tab:leaf', state: 'done' }
}

function makeRuntime() {
  const cleanups = new Map<string, () => void>()
  let push: (event: OrcaEvent) => void = () => {}
  const unsubscribe = vi.fn()
  const subscribeOrcaEvents = vi.fn(
    async (_filter: OrcaEventFilter, emit: (event: OrcaEvent) => void) => {
      push = emit
      return unsubscribe
    }
  )
  const runtime = {
    subscribeOrcaEvents,
    resolveWorktreeIdForSelector: vi.fn(async (selector: string) => `resolved(${selector})`),
    registerSubscriptionCleanup: (id: string, cleanup: () => void) => cleanups.set(id, cleanup),
    cleanupSubscription: (id: string) => {
      cleanups.get(id)?.()
      cleanups.delete(id)
    }
  } as unknown as OrcaRuntimeService
  return { runtime, subscribeOrcaEvents, unsubscribe, cleanups, push: (e: OrcaEvent) => push(e) }
}

const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))

describe('events.subscribe', () => {
  it('rejects event names nothing matches', () => {
    expect(subscribeMethod.params?.safeParse({ names: ['agent.done'] }).success).toBe(false)
    expect(subscribeMethod.params?.safeParse({ names: ['terminal.*'] }).success).toBe(true)
    expect(subscribeMethod.params?.safeParse({}).success).toBe(true)
  })

  it('sends ready, then one frame per event, then end when the client goes away', async () => {
    const { runtime, subscribeOrcaEvents, unsubscribe, push } = makeRuntime()
    const abort = new AbortController()
    const frames: unknown[] = []
    const done = subscribeMethod.handler(
      subscribeMethod.params?.parse({
        names: ['agent.*'],
        worktree: 'branch:main',
        terminal: 'term_a'
      }),
      { runtime, requestId: 'r1', signal: abort.signal } as RpcContext,
      (frame) => frames.push(frame)
    )
    await flush()
    expect(subscribeOrcaEvents).toHaveBeenCalledWith(
      { names: ['agent.*'], worktreeId: 'resolved(branch:main)', terminal: 'term_a' },
      expect.any(Function)
    )
    push(agentEvent)
    abort.abort()
    await done
    expect(frames).toEqual([
      { type: 'ready', subscriptionId: expect.stringContaining('events:') },
      { type: 'event', event: agentEvent },
      { type: 'end' }
    ])
    expect(unsubscribe).toHaveBeenCalledTimes(1)
  })

  it('detaches a subscription that is cleaned up before its sources attach', async () => {
    const { runtime, unsubscribe, cleanups } = makeRuntime()
    const frames: unknown[] = []
    const done = subscribeMethod.handler(
      subscribeMethod.params?.parse({}),
      { runtime, connectionId: 'c1' } as RpcContext,
      (frame) => frames.push(frame)
    )
    for (const cleanup of cleanups.values()) {
      cleanup()
    }
    await done
    await flush()
    expect(unsubscribe).toHaveBeenCalledTimes(1)
    expect(frames).toEqual([{ type: 'end' }])
  })

  it('ends at once when the client is already gone', async () => {
    const { runtime } = makeRuntime()
    const abort = new AbortController()
    abort.abort()
    const frames: unknown[] = []
    await subscribeMethod.handler(
      subscribeMethod.params?.parse({}),
      { runtime, signal: abort.signal } as RpcContext,
      (frame) => frames.push(frame)
    )
    await flush()
    expect(frames).toEqual([{ type: 'end' }])
  })

  it('fails the call instead of hanging when a source cannot start', async () => {
    const { runtime, subscribeOrcaEvents } = makeRuntime()
    subscribeOrcaEvents.mockRejectedValueOnce(new Error('tabs unavailable'))
    await expect(
      subscribeMethod.handler(
        subscribeMethod.params?.parse({}),
        { runtime } as RpcContext,
        () => {}
      )
    ).rejects.toThrow('tabs unavailable')
  })
})
