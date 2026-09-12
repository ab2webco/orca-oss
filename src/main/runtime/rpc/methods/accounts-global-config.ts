import { z } from 'zod'
import { defineMethod, type RpcAnyMethod } from '../core'

// Why the selection is optional and its arrays are not: a legacy caller that
// sends nothing means "seed everything", while an explicit empty list means
// "seed none" — collapsing the two would silently re-seed what the user opted out of.
const GlobalConfigSyncSelectionParams = z.object({
  mcpServerNames: z.array(z.string()),
  skillNames: z.array(z.string()),
  hookIds: z.array(z.string()),
  writeGlobalHooks: z.boolean()
})

const SyncGlobalConfigForAccountParams = z.object({
  accountId: z.string().min(1, 'Missing accountId'),
  selection: GlobalConfigSyncSelectionParams.nullish()
})

const ResyncGlobalConfigParams = z.object({
  selection: GlobalConfigSyncSelectionParams.nullish()
})

const ClearGlobalConfigForAccountParams = z.object({
  accountId: z.string().min(1, 'Missing accountId')
})

// Why its own module: the global-config lane is four methods with their own
// params, and accounts.ts is at the max-lines budget — the ratchet says split.
export const GLOBAL_CONFIG_METHODS: readonly RpcAnyMethod[] = [
  defineMethod({
    // Why these four join the same exemption: they name an account id and config
    // the caller already chose, never a host path, and the inventory reply lists
    // only names and ids of the owner's own global config — no credential material.
    name: 'accounts.previewGlobalConfig',
    params: null,
    handler: async (_params, { runtime }) => runtime.buildGlobalConfigSyncInventory()
  }),
  defineMethod({
    name: 'accounts.syncGlobalConfigForAccount',
    params: SyncGlobalConfigForAccountParams,
    handler: async (params, { runtime }) => {
      runtime.syncGlobalConfigForClaudeAccount(params.accountId, params.selection ?? undefined)
      return { synced: true }
    }
  }),
  defineMethod({
    name: 'accounts.resyncGlobalConfig',
    params: ResyncGlobalConfigParams,
    handler: async (params, { runtime }) => ({
      processed: runtime.resyncClaudeGlobalConfig(params.selection ?? undefined)
    })
  }),
  defineMethod({
    name: 'accounts.clearGlobalConfigForAccount',
    params: ClearGlobalConfigForAccountParams,
    handler: async (params, { runtime }) => {
      runtime.clearGlobalConfigForClaudeAccount(params.accountId)
      return { cleared: true }
    }
  })
]
