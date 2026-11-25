import { z } from 'zod'
import { defineMethod, type RpcMethod } from '../core'
import type { OrcaRuntimeService } from '../../orca-runtime'

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

async function liveLeadHandles(runtime: OrcaRuntimeService): Promise<Set<string>> {
  const { leads } = await runtime.getGameLeads().list()
  return new Set(leads.map((one) => one.handle))
}

/** The leads on this Orca host: `orca game lead` registers one, `orca game leads` lists them. */
export const ORCHESTRATOR_GAME_LEADS_METHODS: RpcMethod[] = [
  defineMethod({
    name: 'game.leadRegister',
    params: GameLeadRegisterParams,
    handler: async (params, { runtime }) => {
      const before = await liveLeadHandles(runtime)
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
      // Why: a repeat `game lead` in the lead's own pane is no new start, and must not reopen the panel.
      const started = result.resumed?.handle ?? (result.registered ? params.terminalHandle : null)
      if (started && (params.fresh || !before.has(started))) {
        // Why the runtime, not a Claude hook: an org plugin may skip orca-game's hooks (ORCA-1414).
        runtime.noteGameLeadStarted(started, result.resumed ? undefined : params.worktreeId)
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
  // Why no caller pane: a pane that ran /orca-game:lead would be left over beside the reopened one (ORCA-717).
  defineMethod({
    name: 'game.leadReopen',
    params: z.object({
      worktreeId: z.string(),
      project: z.string().max(200),
      label: z.string().max(80)
    }),
    handler: async (params, { runtime }) => {
      const result = await runtime.getGameLeads().reopen(params)
      const lead = result.resumed?.handle ?? result.live?.handle
      if (lead) {
        void runtime
          .getGameBoard()
          .heldAnswers.deliver({ terminalHandle: lead })
          .catch(() => undefined)
      }
      if (result.resumed) {
        runtime.noteGameLeadStarted(result.resumed.handle)
      }
      return result
    }
  }),
  defineMethod({
    name: 'game.leads',
    params: null,
    handler: (_params, { runtime }) => runtime.getGameLeads().list()
  })
]
