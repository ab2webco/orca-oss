import { useEffect, useState } from 'react'
import type { PlaneProject, PlaneWorkspace } from '../../../../shared/plane-types'
import { useAppStore } from '@/store'
import { Label } from '@/components/ui/label'
import { translate } from '@/i18n/i18n'

type PlaneBoardSelectorProps = {
  workspaces: PlaneWorkspace[]
}

const SELECT_CLASS =
  'h-8 min-w-0 flex-1 rounded-md border border-border bg-background px-2 text-xs text-foreground outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50'

// Why: mirrors defaultLinearTeamSelection's persisted-selection pattern (a
// settings field the Tasks surface reads to open the right board on launch —
// see mem #2170), but Plane's project list is workspace-scoped and must be
// fetched, unlike Linear's team list which comes from status. A native
// <select> (not the shadcn Select primitive) matches TasksPane's existing
// launch-prompt <textarea>, keeping this testable without a Radix portal.
export function PlaneBoardSelector({
  workspaces
}: PlaneBoardSelectorProps): React.JSX.Element | null {
  const settings = useAppStore((s) => s.settings)
  const updateSettings = useAppStore((s) => s.updateSettings)
  const listPlaneProjects = useAppStore((s) => s.listPlaneProjects)
  const getCachedPlaneProjects = useAppStore((s) => s.getCachedPlaneProjects)

  const persistedSelection = settings?.defaultPlaneSelection ?? null
  const persistedWorkspace = persistedSelection
    ? (workspaces.find(
        (workspace) => workspace.workspaceSlug === persistedSelection.workspaceSlug
      ) ?? null)
    : null

  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState<string>(
    persistedWorkspace?.id ?? workspaces[0]?.id ?? ''
  )
  const [selectedProjectId, setSelectedProjectId] = useState<string>(
    persistedWorkspace ? (persistedSelection?.projectId ?? '') : ''
  )
  const [projects, setProjects] = useState<PlaneProject[]>(
    getCachedPlaneProjects(selectedWorkspaceId || null) ?? []
  )
  const [loadingProjects, setLoadingProjects] = useState(false)

  useEffect(() => {
    if (!selectedWorkspaceId) {
      setProjects([])
      return
    }
    let cancelled = false
    const cached = getCachedPlaneProjects(selectedWorkspaceId)
    if (cached) {
      setProjects(cached)
    }
    setLoadingProjects(true)
    void listPlaneProjects(selectedWorkspaceId).then((result) => {
      if (cancelled) {
        return
      }
      setProjects(result)
      setLoadingProjects(false)
    })
    return () => {
      cancelled = true
    }
  }, [selectedWorkspaceId, listPlaneProjects, getCachedPlaneProjects])

  if (workspaces.length === 0) {
    return null
  }

  const handleWorkspaceChange = (workspaceId: string): void => {
    setSelectedWorkspaceId(workspaceId)
    setSelectedProjectId('')
  }

  const handleProjectChange = (projectId: string): void => {
    setSelectedProjectId(projectId)
    const workspace = workspaces.find((entry) => entry.id === selectedWorkspaceId)
    if (!workspace || !projectId) {
      return
    }
    void updateSettings({
      defaultPlaneSelection: { workspaceSlug: workspace.workspaceSlug, projectId }
    })
  }

  return (
    <div className="space-y-1.5">
      <Label className="text-xs">
        {translate('auto.components.settings.plane.board.selector.label', 'Active board')}
      </Label>
      <div className="flex flex-col gap-2 sm:flex-row">
        <select
          aria-label={translate(
            'auto.components.settings.plane.board.selector.workspace_aria',
            'Plane workspace'
          )}
          value={selectedWorkspaceId}
          onChange={(event) => handleWorkspaceChange(event.target.value)}
          className={SELECT_CLASS}
        >
          {workspaces.map((workspace) => (
            <option key={workspace.id} value={workspace.id}>
              {workspace.displayName ?? workspace.workspaceSlug}
            </option>
          ))}
        </select>
        <select
          aria-label={translate(
            'auto.components.settings.plane.board.selector.project_aria',
            'Plane project'
          )}
          value={selectedProjectId}
          onChange={(event) => handleProjectChange(event.target.value)}
          disabled={loadingProjects || projects.length === 0}
          className={SELECT_CLASS}
        >
          <option value="" disabled>
            {loadingProjects
              ? translate(
                  'auto.components.settings.plane.board.selector.loading_projects',
                  'Loading projects…'
                )
              : translate(
                  'auto.components.settings.plane.board.selector.select_project',
                  'Select a project'
                )}
          </option>
          {projects.map((project) => (
            <option key={project.id} value={project.id}>
              {project.name}
            </option>
          ))}
        </select>
      </div>
    </div>
  )
}
