import { z } from 'zod'
import { defineMethod, type RpcMethod } from '../core'

const GameQueueDepartureParams = z.object({
  worktreeId: z.string().optional(),
  terminalHandle: z.string().optional(),
  number: z.number().int().positive()
})

// Why its own method: the watch reads it only when an entry leaves, so the state read stays cached.
export const ORCHESTRATOR_GAME_QUEUE_DEPARTURE_METHODS: RpcMethod[] = [
  defineMethod({
    name: 'game.queueDeparture',
    params: GameQueueDepartureParams,
    handler: async (params, { runtime }) => runtime.readGameQueueDeparture(params)
  })
]
