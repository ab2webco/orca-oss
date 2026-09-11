import { z } from 'zod'
import { defineMethod, type RpcMethod } from '../core'
import {
  detectRemoteAgents,
  detectRemoteWindowsTerminalCapabilities,
  detectInstalledAgentsWithShellPathHydration,
  refreshShellPathAndDetectAgents,
  runPreflightCheck
} from '../../../ipc/preflight'
import { probeRepairableAgentCliSelfUpdates } from '../../../ipc/agent-cli-self-update-probe'
import { repairAgentCliSelfUpdate } from '../../../ipc/agent-cli-self-update-repair'
import { REPAIRABLE_AGENT_CLI_IDS } from '../../../../shared/agent-cli-self-update'

const PreflightCheck = z.object({
  force: z.boolean().optional()
})
const PreflightDetectRemoteAgents = z.object({
  connectionId: z.string().min(1)
})
const PreflightDetectRemoteWindowsTerminalCapabilities = z.object({
  connectionId: z.string().min(1)
})
const PreflightRepairAgentSelfUpdate = z.object({
  agentId: z.enum(REPAIRABLE_AGENT_CLI_IDS)
})

export const PREFLIGHT_METHODS: RpcMethod[] = [
  defineMethod({
    name: 'preflight.check',
    params: PreflightCheck,
    handler: async (params) => runPreflightCheck(params.force)
  }),
  defineMethod({
    name: 'preflight.detectAgents',
    params: null,
    handler: async () => detectInstalledAgentsWithShellPathHydration()
  }),
  defineMethod({
    name: 'preflight.detectRemoteAgents',
    params: PreflightDetectRemoteAgents,
    handler: async (params) => detectRemoteAgents(params)
  }),
  defineMethod({
    name: 'preflight.detectRemoteWindowsTerminalCapabilities',
    params: PreflightDetectRemoteWindowsTerminalCapabilities,
    handler: async (params) => detectRemoteWindowsTerminalCapabilities(params)
  }),
  defineMethod({
    name: 'preflight.refreshAgents',
    params: null,
    handler: async () => refreshShellPathAndDetectAgents()
  }),
  // Why en el runtime y no solo en IPC local: el caso que esto resuelve es
  // justamente el del servidor remoto — un CLI puesto con `npm i -g` por root
  // que las instancias, que corren sin privilegios, no pueden actualizar.
  defineMethod({
    name: 'preflight.checkAgentSelfUpdate',
    params: null,
    handler: async () => probeRepairableAgentCliSelfUpdates()
  }),
  defineMethod({
    name: 'preflight.repairAgentSelfUpdate',
    params: PreflightRepairAgentSelfUpdate,
    handler: async (params) => repairAgentCliSelfUpdate(params.agentId)
  })
]
