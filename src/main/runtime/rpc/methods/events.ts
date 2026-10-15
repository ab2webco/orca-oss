import { z } from 'zod'
import { findUnknownOrcaEventNames } from '../../../../shared/orca-events'
import { defineStreamingMethod, type RpcAnyMethod } from '../core'

let eventsSubscriptionSeq = 0

const EventsSubscribeParams = z.object({
  names: z
    .array(z.string().min(1).max(128))
    .max(32)
    .default([])
    .refine((names) => findUnknownOrcaEventNames(names).length === 0, {
      message: 'Unknown event name'
    }),
  worktree: z.string().min(1).optional(),
  terminal: z.string().min(1).optional()
})

// Why: `orca events` lets scripts and agents react to Orca instead of polling terminal state.
export const EVENT_METHODS: readonly RpcAnyMethod[] = [
  defineStreamingMethod({
    name: 'events.subscribe',
    params: EventsSubscribeParams,
    handler: async (params, { runtime, connectionId, requestId, signal }, emit) => {
      const worktreeId = params.worktree
        ? await runtime.resolveWorktreeIdForSelector(params.worktree)
        : undefined
      const subscriptionId = `events:${connectionId ?? 'local'}:${requestId ?? ++eventsSubscriptionSeq}`
      let closed = false
      let unsubscribe: (() => void) | null = null
      await new Promise<void>((resolve, reject) => {
        runtime.registerSubscriptionCleanup(
          subscriptionId,
          () => {
            if (closed) {
              return
            }
            closed = true
            unsubscribe?.()
            emit({ type: 'end' })
            resolve()
          },
          connectionId
        )
        // Why: the local socket has no connection id to reap by; its abort signal is the close.
        const close = (): void => runtime.cleanupSubscription(subscriptionId)
        if (signal?.aborted) {
          close()
          return
        }
        signal?.addEventListener('abort', close, { once: true })
        runtime
          .subscribeOrcaEvents(
            { names: params.names, worktreeId, terminal: params.terminal },
            (event) => emit({ type: 'event', event })
          )
          .then((detach) => {
            if (closed) {
              detach()
              return
            }
            unsubscribe = detach
            emit({ type: 'ready', subscriptionId })
          })
          .catch((error: unknown) => {
            closed = true
            signal?.removeEventListener('abort', close)
            runtime.cleanupSubscription(subscriptionId)
            reject(error)
          })
      })
    }
  })
]
