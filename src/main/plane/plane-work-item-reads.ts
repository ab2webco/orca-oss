// Supporting Plane reads: projects, states, labels, workspace members. Split
// from work-items.ts to stay under the oxlint max-lines cap without a
// suppression. listProjectsForClient is also used by work-items.ts to
// resolve which project a work item belongs to, since Plane's work-item
// list/get endpoints only expand assignees/labels/state, never `project`.
import {
  acquire,
  clearWorkspaceTokenOnAuthError,
  getClients,
  release,
  planeRequest,
  toViewer,
  USERS_ME_PATH,
  type PlaneClientForWorkspace
} from './client'
import { getCachedViewer, getPlaneWorkspaceId, setCachedViewer } from './plane-workspace-store'
import { runBoundedIntegrationFanout } from '../integration-fanout'
import {
  INTEGRATION_PAGINATION_MAX_PAGES,
  IntegrationPaginationBudget
} from '../integration-pagination-budget'
import { boundedIntegrationErrorLog } from '../integration-error-message'
import { fetchAllPlanePages, type PlanePage } from './plane-cursor-pagination'
import {
  mapPlaneLabel,
  mapPlaneProject,
  mapPlaneProjectMember,
  mapPlaneState,
  mapPlaneUser
} from './plane-work-item-mappers'
import type {
  PlaneLabel,
  PlaneProject,
  PlaneState,
  PlaneUser,
  PlaneViewer,
  PlaneWorkspaceSelection
} from '../../shared/plane-types'

type PlaneRecord = Record<string, unknown>

function workspacePath(client: PlaneClientForWorkspace, suffix: string): string {
  return `/api/v1/workspaces/${encodeURIComponent(client.workspaceSlug)}${suffix}`
}

function pagedQuery(cursor: string | undefined): string {
  const params = new URLSearchParams({ per_page: '100' })
  if (cursor) {
    params.set('cursor', cursor)
  }
  return params.toString()
}

export async function listProjectsForClient(
  client: PlaneClientForWorkspace
): Promise<PlaneProject[]> {
  const budget = new IntegrationPaginationBudget()
  const raws = await fetchAllPlanePages<PlaneRecord>(
    (cursor) =>
      planeRequest<PlanePage<PlaneRecord>>(
        client,
        `${workspacePath(client, '/projects/')}?${pagedQuery(cursor)}`
      ),
    budget,
    INTEGRATION_PAGINATION_MAX_PAGES
  )
  // workspaceId as well as the slug: `project list --json` is the only place a
  // caller can learn the saved workspace id that --workspace takes, and it is
  // what tells two same-slug workspaces apart on an aggregate read (ORCA-139).
  const workspaceId = getPlaneWorkspaceId(client.baseUrl, client.workspaceSlug)
  return raws.map((raw) => mapPlaneProject(raw, client.workspaceSlug, workspaceId))
}

export async function listProjects(
  workspaceId?: PlaneWorkspaceSelection | null
): Promise<PlaneProject[]> {
  const entries = getClients(workspaceId)
  if (entries.length === 0) {
    return []
  }
  const fanout = await runBoundedIntegrationFanout(
    entries,
    async (client) => {
      await acquire()
      try {
        return await listProjectsForClient(client)
      } catch (error) {
        clearWorkspaceTokenOnAuthError(client, error)
        console.warn('[plane] listProjects failed:', boundedIntegrationErrorLog(error))
        return []
      } finally {
        release()
      }
    },
    (projects) => projects
  )
  if (fanout.truncated) {
    console.warn(
      '[plane] Cross-workspace projects exceeded their aggregate result budget; truncating.'
    )
  }
  // Why: workspace-then-name keeps a cross-workspace read grouped instead of
  // interleaving two workspaces' projects into one anonymous list. workspaceId
  // breaks the slug tie because identity is (baseUrl, slug) — a self-hosted and
  // a cloud workspace can share a slug (ORCA-139).
  return fanout.results
    .flat()
    .sort(
      (a, b) =>
        (a.workspaceSlug ?? '').localeCompare(b.workspaceSlug ?? '') ||
        (a.workspaceId ?? '').localeCompare(b.workspaceId ?? '') ||
        a.name.localeCompare(b.name)
    )
}

// Resolves the connected viewer (users/me) for the selected workspace so the
// CLI can map `--me` to a concrete assignee id. Uses the in-memory viewer cache
// when present, otherwise fetches once and caches. Returns null when not
// connected or the identity cannot be resolved so callers degrade cleanly.
export async function getViewer(
  workspaceId?: PlaneWorkspaceSelection | null
): Promise<PlaneViewer | null> {
  const client = getClients(workspaceId)[0]
  if (!client) {
    return null
  }
  const cacheKey = getPlaneWorkspaceId(client.baseUrl, client.workspaceSlug)
  const cached = getCachedViewer(cacheKey)
  if (cached) {
    return cached
  }
  await acquire()
  try {
    const viewer = toViewer(await planeRequest<Record<string, unknown>>(client, USERS_ME_PATH))
    if (viewer.id) {
      setCachedViewer(cacheKey, viewer)
      return viewer
    }
    return null
  } catch (error) {
    clearWorkspaceTokenOnAuthError(client, error)
    console.warn('[plane] getViewer failed:', boundedIntegrationErrorLog(error))
    return null
  } finally {
    release()
  }
}

export async function listStates(
  projectId: string,
  workspaceId?: PlaneWorkspaceSelection | null
): Promise<PlaneState[]> {
  const entry = getClients(workspaceId)[0]
  if (!entry) {
    return []
  }
  await acquire()
  try {
    const budget = new IntegrationPaginationBudget()
    const raws = await fetchAllPlanePages<PlaneRecord>(
      (cursor) =>
        planeRequest<PlanePage<PlaneRecord>>(
          entry,
          `${workspacePath(entry, `/projects/${encodeURIComponent(projectId)}/states/`)}?${pagedQuery(cursor)}`
        ),
      budget,
      INTEGRATION_PAGINATION_MAX_PAGES
    )
    return raws.map(mapPlaneState).sort((a, b) => (a.sequence ?? 0) - (b.sequence ?? 0))
  } catch (error) {
    clearWorkspaceTokenOnAuthError(entry, error)
    console.warn('[plane] listStates failed:', boundedIntegrationErrorLog(error))
    return []
  } finally {
    release()
  }
}

export async function listLabels(
  projectId: string,
  workspaceId?: PlaneWorkspaceSelection | null
): Promise<PlaneLabel[]> {
  const entry = getClients(workspaceId)[0]
  if (!entry) {
    return []
  }
  await acquire()
  try {
    const budget = new IntegrationPaginationBudget()
    const raws = await fetchAllPlanePages<PlaneRecord>(
      (cursor) =>
        planeRequest<PlanePage<PlaneRecord>>(
          entry,
          `${workspacePath(entry, `/projects/${encodeURIComponent(projectId)}/labels/`)}?${pagedQuery(cursor)}`
        ),
      budget,
      INTEGRATION_PAGINATION_MAX_PAGES
    )
    return raws.map(mapPlaneLabel)
  } catch (error) {
    clearWorkspaceTokenOnAuthError(entry, error)
    console.warn('[plane] listLabels failed:', boundedIntegrationErrorLog(error))
    return []
  } finally {
    release()
  }
}

// Project members live under the workspace's project scope. Returns [] on
// failure or empty so callers can gracefully fall back to workspace members.
async function listProjectMembers(
  projectId: string,
  workspaceId?: PlaneWorkspaceSelection | null
): Promise<PlaneUser[]> {
  const entry = getClients(workspaceId)[0]
  if (!entry) {
    return []
  }
  await acquire()
  try {
    const raws = await planeRequest<PlaneRecord[]>(
      entry,
      workspacePath(entry, `/projects/${encodeURIComponent(projectId)}/members/`)
    )
    return raws.map(mapPlaneProjectMember).filter((user): user is PlaneUser => !!user)
  } catch (error) {
    clearWorkspaceTokenOnAuthError(entry, error)
    console.warn('[plane] listProjectMembers failed:', boundedIntegrationErrorLog(error))
    return []
  } finally {
    release()
  }
}

export async function listMembers(
  workspaceId?: PlaneWorkspaceSelection | null,
  projectId?: string
): Promise<PlaneUser[]> {
  // Scope the Assignee picker to the project (matching Plane's own UI); if the
  // project-members request fails or is empty, fall back to workspace members.
  if (projectId) {
    const projectMembers = await listProjectMembers(projectId, workspaceId)
    if (projectMembers.length > 0) {
      return projectMembers
    }
  }
  const entries = getClients(workspaceId)
  if (entries.length === 0) {
    return []
  }
  const fanout = await runBoundedIntegrationFanout(
    entries,
    async (client) => {
      await acquire()
      try {
        const raws = await planeRequest<PlaneRecord[]>(client, workspacePath(client, '/members/'))
        return raws.map(mapPlaneUser).filter((user): user is PlaneUser => !!user)
      } catch (error) {
        clearWorkspaceTokenOnAuthError(client, error)
        console.warn('[plane] listMembers failed:', boundedIntegrationErrorLog(error))
        return []
      } finally {
        release()
      }
    },
    (users) => users
  )
  if (fanout.truncated) {
    console.warn(
      '[plane] Cross-workspace members exceeded their aggregate result budget; truncating.'
    )
  }
  return fanout.results.flat()
}
