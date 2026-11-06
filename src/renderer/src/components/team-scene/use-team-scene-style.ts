import { useMemo } from 'react'
import { useAppStore } from '@/store'
import type { GamePanelStyle } from '../../../../shared/orchestrator-game-panel'
import { resolveOrchestratorGamePanel } from '../../../../shared/orchestrator-game-panel-layers'

/** The scene style after global Settings and this machine's choice for the project. */
export function useTeamSceneStyle(): GamePanelStyle {
  const repoId = useAppStore((s) =>
    s.activeWorktreeId ? (s.getKnownWorktreeById(s.activeWorktreeId)?.repoId ?? null) : null
  )
  const global = useAppStore((s) => s.settings?.orchestratorGame)
  const local = useAppStore((s) =>
    repoId ? s.settings?.orchestratorGameProjects?.[repoId] : undefined
  )
  return useMemo(() => resolveOrchestratorGamePanel({ global, local }).style, [global, local])
}
