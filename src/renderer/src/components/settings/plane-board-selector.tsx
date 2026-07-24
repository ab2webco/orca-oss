import { useEffect, useState } from 'react'
import type { PlaneProject, PlaneWorkspace } from '../../../../shared/plane-types'
import { useAppStore } from '@/store'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { translate } from '@/i18n/i18n'

type PlaneBoardSelectorProps = {
  workspaces: PlaneWorkspace[]
  className?: string
}

// Why: mirrors defaultLinearTeamSelection's persisted-selection pattern (a
// settings field the Tasks surface reads to open the right board on launch —
// see mem #2170), but Plane's project list is workspace-scoped and must be
// fetched, unlike Linear's team list which comes from status.
export function PlaneBoardSelector({
  workspaces,
  className
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

  const projectsDisabled = loadingProjects || projects.length === 0
  const projectPlaceholder = loadingProjects
    ? translate(
        'auto.components.settings.plane.board.selector.loading_projects',
        'Loading projects…'
      )
    : translate('auto.components.settings.plane.board.selector.select_project', 'Select a project')

  return (
    <div className={className ?? 'space-y-2'}>
      <Label className="text-xs text-muted-foreground">
        {translate('auto.components.settings.plane.board.selector.label', 'Active board')}
      </Label>
      <div className="flex flex-col gap-2">
        <Select value={selectedWorkspaceId} onValueChange={handleWorkspaceChange}>
          <SelectTrigger
            size="sm"
            className="w-full text-xs"
            aria-label={translate(
              'auto.components.settings.plane.board.selector.workspace_aria',
              'Plane workspace'
            )}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {workspaces.map((workspace) => (
              <SelectItem key={workspace.id} value={workspace.id}>
                {workspace.displayName ?? workspace.workspaceSlug}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={selectedProjectId || undefined}
          onValueChange={handleProjectChange}
          disabled={projectsDisabled}
        >
          <SelectTrigger
            size="sm"
            className="w-full text-xs"
            aria-label={translate(
              'auto.components.settings.plane.board.selector.project_aria',
              'Plane project'
            )}
          >
            <SelectValue placeholder={projectPlaceholder} />
          </SelectTrigger>
          <SelectContent>
            {projects.map((project) => (
              <SelectItem key={project.id} value={project.id}>
                {project.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  )
}
