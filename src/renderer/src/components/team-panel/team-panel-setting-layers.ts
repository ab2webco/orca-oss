import { useEffect } from 'react'
import { create } from 'zustand'
import { useAppStore } from '@/store'
import { checkRuntimeHooks } from '@/runtime/runtime-hooks-client'
import { getRepoExecutionHostId, type ExecutionHostId } from '../../../../shared/execution-host'
import type { OrchestratorGameLayer } from '../../../../shared/orchestrator-game-config'
import { isFolderRepo } from '../../../../shared/repo-kind'

export type TeamPanelSettingLayers = {
  global: OrchestratorGameLayer | undefined
  project: OrchestratorGameLayer | undefined
  local: OrchestratorGameLayer | undefined
}

// Why a shared store: the look, the scene style and each member header ask; orca.yaml is read once per project.
const useProjectLayers = create<{ byScope: Record<string, OrchestratorGameLayer | null> }>(() => ({
  byScope: {}
}))
// Why counted: the first part to open re-reads, as Settings does, so a hand edit shows on reopen.
const readers = new Map<string, number>()

/** Test seam: forget every orca.yaml layer read so far. */
export function resetTeamPanelProjectLayers(): void {
  readers.clear()
  useProjectLayers.setState({ byScope: {} })
}

function openProjectLayer(
  scope: string,
  repoId: string,
  hostId: ExecutionHostId,
  background: boolean
): () => void {
  // Why: a background reader (the sidebar's rows) reads once but never holds off a panel's re-read.
  if (background) {
    if (!(scope in useProjectLayers.getState().byScope)) {
      readProjectLayer(scope, repoId, hostId)
    }
    return () => {}
  }
  const open = readers.get(scope) ?? 0
  readers.set(scope, open + 1)
  if (open === 0) {
    readProjectLayer(scope, repoId, hostId)
  }
  return () => readers.set(scope, Math.max(0, (readers.get(scope) ?? 1) - 1))
}

function readProjectLayer(scope: string, repoId: string, hostId: ExecutionHostId): void {
  void checkRuntimeHooks(useAppStore.getState().settings, repoId, hostId)
    .then((result) => result.hooks?.orchestratorGame ?? null)
    // Why null on failure: an unreadable orca.yaml must not hide the global and machine layers.
    .catch(() => null)
    .then((layer) =>
      useProjectLayers.setState((s) => ({ byScope: { ...s.byScope, [scope]: layer } }))
    )
}

/** The active project's panel settings: global Settings, its orca.yaml and this machine's override. */
export function useTeamPanelSettingLayers(
  options: { background?: boolean } = {}
): TeamPanelSettingLayers {
  const background = options.background === true
  const repoId = useAppStore((s) =>
    s.activeWorktreeId ? (s.getKnownWorktreeById(s.activeWorktreeId)?.repoId ?? null) : null
  )
  const repo = useAppStore((s) => (repoId ? s.repos.find((one) => one.id === repoId) : undefined))
  // Why the repo's host, not the active workspace's: orca.yaml lives where the project lives.
  const hostId = repo && !isFolderRepo(repo) ? getRepoExecutionHostId(repo) : null
  const global = useAppStore((s) => s.settings?.orchestratorGame)
  const local = useAppStore((s) =>
    repoId ? s.settings?.orchestratorGameProjects?.[repoId] : undefined
  )
  const scope = repoId && hostId ? `${hostId}|${repoId}` : null
  useEffect(() => {
    return scope && repoId && hostId
      ? openProjectLayer(scope, repoId, hostId, background)
      : undefined
  }, [background, hostId, repoId, scope])
  const project = useProjectLayers((s) => (scope ? (s.byScope[scope] ?? undefined) : undefined))
  return { global, project, local }
}
