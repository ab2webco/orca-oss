import { useEffect, useMemo } from 'react'
import { create } from 'zustand'
import { useAppStore } from '@/store'
import { checkRuntimeHooks } from '@/runtime/runtime-hooks-client'
import type { ExecutionHostId } from '../../../../shared/execution-host'
import type { OrchestratorGameLayer } from '../../../../shared/orchestrator-game-config'
import type { GamePanelLook } from '../../../../shared/orchestrator-game-panel'
import { resolveOrchestratorGamePanel } from '../../../../shared/orchestrator-game-panel-layers'

/** ORCA-1071's `orchestratorGame.panel.look`. */
export type TeamPanelLook = GamePanelLook

// Why a shared store: the panel, its tab and each member header ask; orca.yaml is read once per project.
const useProjectLayers = create<{ byScope: Record<string, OrchestratorGameLayer | null> }>(() => ({
  byScope: {}
}))
const reading = new Set<string>()

/** Test seam: forget every orca.yaml layer read so far. */
export function resetTeamPanelProjectLayers(): void {
  reading.clear()
  useProjectLayers.setState({ byScope: {} })
}

function readProjectLayer(scope: string, repoId: string, hostId: ExecutionHostId | null): void {
  if (reading.has(scope)) {
    return
  }
  reading.add(scope)
  void checkRuntimeHooks(useAppStore.getState().settings, repoId, hostId ?? undefined)
    .then((result) => result.hooks?.orchestratorGame ?? null)
    // Why null on failure: an unreadable orca.yaml must not hide the global and machine looks.
    .catch(() => null)
    .then((layer) =>
      useProjectLayers.setState((s) => ({ byScope: { ...s.byScope, [scope]: layer } }))
    )
}

/** The panel look after global Settings, the project's orca.yaml and this machine's override. */
export function useTeamPanelLook(): TeamPanelLook {
  const repoId = useAppStore((s) =>
    s.activeWorktreeId ? (s.getKnownWorktreeById(s.activeWorktreeId)?.repoId ?? null) : null
  )
  const hostId = useAppStore((s) => s.activeWorkspaceExecutionHostId)
  const global = useAppStore((s) => s.settings?.orchestratorGame)
  const local = useAppStore((s) =>
    repoId ? s.settings?.orchestratorGameProjects?.[repoId] : undefined
  )
  const scope = repoId ? `${hostId ?? 'local'}|${repoId}` : null
  useEffect(() => {
    if (scope && repoId) {
      readProjectLayer(scope, repoId, hostId)
    }
  }, [hostId, repoId, scope])
  const project = useProjectLayers((s) => (scope ? (s.byScope[scope] ?? undefined) : undefined))
  return useMemo(
    () => resolveOrchestratorGamePanel({ global, project, local }).look,
    [global, local, project]
  )
}
