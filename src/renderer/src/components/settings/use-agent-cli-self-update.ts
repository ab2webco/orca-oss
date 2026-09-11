import React from 'react'
import type {
  AgentCliSelfUpdateStatus,
  RepairableAgentCliId
} from '../../../../shared/agent-cli-self-update'
import { reportAgentCliSelfUpdateRepair } from './AgentCliSelfUpdateNotice'

export type AgentCliSelfUpdateController = {
  statusByAgentId: ReadonlyMap<string, AgentCliSelfUpdateStatus>
  repair: (agentId: RepairableAgentCliId) => Promise<void>
}

function toMap(
  statuses: readonly AgentCliSelfUpdateStatus[]
): Map<string, AgentCliSelfUpdateStatus> {
  return new Map(statuses.map((status) => [status.agentId, status]))
}

export function useAgentCliSelfUpdate(): AgentCliSelfUpdateController {
  const [statusByAgentId, setStatusByAgentId] = React.useState<
    ReadonlyMap<string, AgentCliSelfUpdateStatus>
  >(() => new Map())

  const refresh = React.useCallback(async () => {
    // Why se traga el error: esto es un aviso adicional, no el contenido del
    // panel. Un host que no sepa responder no debe romper la pantalla entera.
    const statuses = await window.api.preflight.checkAgentSelfUpdate().catch(() => [])
    setStatusByAgentId(toMap(statuses))
  }, [])

  React.useEffect(() => {
    void refresh()
  }, [refresh])

  const repair = React.useCallback(
    async (agentId: RepairableAgentCliId) => {
      const result = await window.api.preflight
        .repairAgentSelfUpdate({ agentId })
        .catch((error: unknown) => ({
          kind: 'failed' as const,
          agentId,
          message: error instanceof Error ? error.message : String(error)
        }))
      reportAgentCliSelfUpdateRepair(result)
      await refresh()
    },
    [refresh]
  )

  return { statusByAgentId, repair }
}
