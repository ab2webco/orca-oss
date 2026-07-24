import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { translate } from '@/i18n/i18n'
import { isPlaneProjectSwitcherEnabled } from './task-page-plane-scope'
import type { PlaneProject, PlaneWorkspace } from '../../../shared/plane-types'

type TaskPagePlaneScopeSwitcherProps = {
  workspaces: readonly PlaneWorkspace[]
  selectedWorkspaceId: string | 'all'
  onWorkspaceChange: (value: string) => void
  projects: readonly PlaneProject[]
  projectsLoading: boolean
  selectedProjectId: string | 'all'
  onProjectChange: (value: string) => void
}

// Why: mirrors the Jira "All Jira sites" site switcher in the Tasks header, but
// adds a second, project-level switcher — Plane's list_workspace endpoint
// natively spans every project (see mem #2185), so "all projects" is a real,
// first-class scope rather than a client-side union of per-project fetches.
export function TaskPagePlaneScopeSwitcher({
  workspaces,
  selectedWorkspaceId,
  onWorkspaceChange,
  projects,
  projectsLoading,
  selectedProjectId,
  onProjectChange
}: TaskPagePlaneScopeSwitcherProps): React.JSX.Element {
  return (
    <div className="flex items-center gap-2">
      {workspaces.length > 1 ? (
        <Select value={selectedWorkspaceId} onValueChange={onWorkspaceChange}>
          <SelectTrigger
            aria-label={translate(
              'auto.components.TaskPage.planeWorkspaceSwitcherLabel',
              'Plane workspace'
            )}
            className="h-8 w-[200px] rounded-md border-border/50 bg-muted/50 text-xs font-medium shadow-sm"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">
              {translate('auto.components.TaskPage.planeAllWorkspaces', 'All Plane workspaces')}
            </SelectItem>
            {workspaces.map((workspace) => (
              <SelectItem key={workspace.id} value={workspace.id}>
                {workspace.displayName ?? workspace.workspaceSlug}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : null}
      <Select
        value={selectedProjectId}
        onValueChange={onProjectChange}
        disabled={projectsLoading || !isPlaneProjectSwitcherEnabled(selectedWorkspaceId)}
      >
        <SelectTrigger
          aria-label={translate(
            'auto.components.TaskPage.planeProjectSwitcherLabel',
            'Plane project'
          )}
          className="h-8 w-[200px] rounded-md border-border/50 bg-muted/50 text-xs font-medium shadow-sm"
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">
            {translate('auto.components.TaskPage.planeAllProjects', 'All projects')}
          </SelectItem>
          {projects.map((project) => (
            <SelectItem key={project.id} value={project.id}>
              {project.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}
