import { z } from 'zod'
import { defineMethod, type RpcMethod } from '../core'

const GameLeadRegisterParams = z.object({
  worktreeId: z.string().optional(),
  terminalHandle: z.string().optional(),
  project: z.string().max(200),
  label: z.string().max(80)
})

/** The leads on this Orca host: `orca game lead` registers one, `orca game leads` lists them. */
export const ORCHESTRATOR_GAME_LEADS_METHODS: RpcMethod[] = [
  defineMethod({
    name: 'game.leadRegister',
    params: GameLeadRegisterParams,
    handler: async (params, { runtime }) =>
      runtime.getGameLeads().register({
        worktreeId: params.worktreeId,
        terminalHandle: params.terminalHandle,
        project: params.project,
        label: params.label
      })
  }),
  defineMethod({
    name: 'game.leads',
    params: null,
    handler: (_params, { runtime }) => runtime.getGameLeads().list()
  })
]
