import type { PlaneWorkspace } from '../../../shared/plane-types'

export type PlaneDefaultSelection = { workspaceSlug: string; projectId: string } | null | undefined

export function resolvePlaneWorkspaceIdForSlug(
  workspaces: readonly Pick<PlaneWorkspace, 'id' | 'workspaceSlug'>[],
  workspaceSlug: string | null | undefined
): string | null {
  if (!workspaceSlug) {
    return null
  }
  return workspaces.find((workspace) => workspace.workspaceSlug === workspaceSlug)?.id ?? null
}

// Why: settings.defaultPlaneSelection is only the starting scope for a fresh
// Tasks session (see mem #2205) — it seeds the project switcher exclusively
// when its workspace still matches the effective workspace, otherwise "all
// projects" is the safe default rather than leaking a stale project id.
export function resolveInitialPlaneProjectId(
  workspaces: readonly Pick<PlaneWorkspace, 'id' | 'workspaceSlug'>[],
  effectiveWorkspaceId: string | null,
  defaultSelection: PlaneDefaultSelection
): string {
  if (!effectiveWorkspaceId || !defaultSelection?.projectId) {
    return 'all'
  }
  const targetWorkspaceId = resolvePlaneWorkspaceIdForSlug(
    workspaces,
    defaultSelection.workspaceSlug
  )
  return targetWorkspaceId === effectiveWorkspaceId ? defaultSelection.projectId : 'all'
}

// Why: Plane's list_workspace endpoint natively spans every project when no
// projectId is passed (see mem #2185 spike), so "all workspaces" or "all
// projects" both collapse to an undefined projectId param — a single project
// only ever scopes a fetch when both workspace and project are pinned.
export function getPlaneProjectIdForFetch(
  workspaceSelection: string | 'all' | null | undefined,
  projectSelection: string
): string | undefined {
  if (!workspaceSelection || workspaceSelection === 'all') {
    return undefined
  }
  if (!projectSelection || projectSelection === 'all') {
    return undefined
  }
  return projectSelection
}

// Why: Plane projects are workspace-scoped, so picking one project across
// "all workspaces" is meaningless — the project switcher only makes sense
// once a single workspace is selected.
export function isPlaneProjectSwitcherEnabled(
  workspaceSelection: string | 'all' | null | undefined
): boolean {
  return Boolean(workspaceSelection) && workspaceSelection !== 'all'
}
