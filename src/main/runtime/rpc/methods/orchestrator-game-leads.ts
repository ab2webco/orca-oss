import { z } from 'zod'
import { defineMethod, type RpcMethod } from '../core'

const GameLeadRegisterParams = z.object({
  worktreeId: z.string().optional(),
  terminalHandle: z.string().optional(),
  project: z.string().max(200),
  label: z.string().max(80),
  // Why optional: an older CLI omits it and keeps today's latest-registration-wins behaviour.
  claim: z.boolean().optional(),
  // Why optional: an older CLI omits it; an older host drops it and reopens the stored lead.
  fresh: z.boolean().optional()
})

/** The leads on this Orca host: `orca game lead` registers one, `orca game leads` lists them. */
export const ORCHESTRATOR_GAME_LEADS_METHODS: RpcMethod[] = [
  defineMethod({
    name: 'game.leadRegister',
    params: GameLeadRegisterParams,
    handler: async (params, { runtime }) => {
      const result = await runtime.getGameLeads().register({
        worktreeId: params.worktreeId,
        terminalHandle: params.terminalHandle,
        project: params.project,
        label: params.label,
        ...(params.claim === undefined ? {} : { claim: params.claim }),
        ...(params.fresh === undefined ? {} : { fresh: params.fresh })
      })
      const lead =
        result.resumed?.handle ??
        result.live?.handle ??
        (result.registered ? params.terminalHandle : undefined)
      // Why (ORCA-1100): an answer given while the project had no lead reaches the one that just took over.
      if (lead) {
        void runtime
          .getGameBoard()
          .heldAnswers.deliver({ terminalHandle: lead })
          .catch(() => undefined)
      }
      return result
    }
  }),
  // Why a new method: an older host answers method_not_found, which a client reads as unknown (ORCA-717).
  defineMethod({
    name: 'game.leadStored',
    params: z.object({ worktreeId: z.string() }),
    handler: async (params, { runtime }) => ({
      stored: await runtime.getGameLeads().storedLeadOf({ worktreeId: params.worktreeId })
    })
  }),
  defineMethod({
    name: 'game.leads',
    params: null,
    handler: (_params, { runtime }) => runtime.getGameLeads().list()
  })
]
