// Plane work-item reads: list (built-in PQL filters), search (raw PQL passed
// through), and get (by UUID or human PROJECT-N identifier). No write-back
// here -- set-state/comments/assign land in Slice 5; create/delete/field-edit
// are v1.1. Split from plane-work-item-{mappers,reads}.ts to stay under the
// oxlint max-lines cap without a suppression.
import {
  acquire,
  clearWorkspaceTokenOnAuthError,
  getClients,
  PlaneApiError,
  planeRequest,
  release,
  toViewer,
  USERS_ME_PATH,
  type PlaneClientForWorkspace
} from './client'
import { getCachedViewer, getPlaneWorkspaceId, setCachedViewer } from './plane-workspace-store'
import { filterNeedsViewer, filterPlaneWorkItems } from './plane-work-item-filter'
import { applyPlaneQuery, parsePlaneQuery, queryNeedsViewer } from './plane-pql-filter'
import { runBoundedIntegrationFanout } from '../integration-fanout'
import {
  INTEGRATION_PAGINATION_MAX_ITEMS,
  INTEGRATION_PAGINATION_MAX_PAGES,
  IntegrationPaginationBudget
} from '../integration-pagination-budget'
import { fetchAllPlanePages, type PlanePage } from './plane-cursor-pagination'
import { fetchAcrossClients } from './plane-work-item-fanout'
import {
  resolveWorkItemReferences,
  type PlaneWorkItemReferenceMaps
} from './plane-work-item-reference-resolution'
import { listProjectsForClient } from './plane-work-item-reads'
import { mapPlaneWorkItem } from './plane-work-item-mappers'
import type {
  PlaneProject,
  PlaneWorkItem,
  PlaneWorkItemFilter,
  PlaneWorkspaceSelection
} from '../../shared/plane-types'

// Retrieve-only: expanding a single row is cheaper than three reference
// lists. The list path deliberately sends no expand — Plane resolves it per
// row server-side, so list latency grew linearly with item count (ORCA-333) —
// and resolves bare UUIDs via resolveWorkItemReferences instead.
const WORK_ITEM_EXPAND = 'assignees,labels,state'
// PROJECT-N: uppercase alnum prefix + dash + sequence number.
const IDENTIFIER_RE = /^[A-Z0-9]+-\d+$/

type PlaneRecord = Record<string, unknown>

// Exported: plane-work-item-writes.ts (Slice 5) reuses this path builder for
// update/comment endpoints, all nested under the same project-scoped route.
export function workItemsBase(
  client: PlaneClientForWorkspace,
  projectId: string | undefined
): string {
  const workspace = `/api/v1/workspaces/${encodeURIComponent(client.workspaceSlug)}`
  return projectId
    ? `${workspace}/projects/${encodeURIComponent(projectId)}/work-items/`
    : `${workspace}/work-items/`
}

function listQuery(pql: string | undefined, cursor: string | undefined): string {
  const params = new URLSearchParams({ per_page: '100' })
  if (pql) {
    params.set('pql', pql)
  }
  if (cursor) {
    params.set('cursor', cursor)
  }
  return params.toString()
}

async function buildProjectsById(
  client: PlaneClientForWorkspace
): Promise<Map<string, PlaneProject>> {
  const projects = await listProjectsForClient(client)
  return new Map(projects.map((project) => [project.id, project]))
}

function toWorkItem(
  raw: PlaneRecord,
  client: PlaneClientForWorkspace,
  projectsById: Map<string, PlaneProject>,
  references?: PlaneWorkItemReferenceMaps
): PlaneWorkItem {
  const rawProjectId = typeof raw.project === 'string' ? raw.project : ''
  const project = projectsById.get(rawProjectId) ?? {
    id: rawProjectId,
    identifier: '',
    name: 'Unknown project'
  }
  return mapPlaneWorkItem(raw, {
    baseUrl: client.baseUrl,
    workspaceSlug: client.workspaceSlug,
    project,
    labelsById: references?.labelNamesById,
    statesById: references?.statesById,
    usersById: references?.usersById
  })
}

async function fetchProjectWorkItems(
  client: PlaneClientForWorkspace,
  projectId: string,
  pql: string | undefined,
  projectsById: Map<string, PlaneProject>
): Promise<PlaneWorkItem[]> {
  const budget = new IntegrationPaginationBudget()
  const raws = await fetchAllPlanePages<PlaneRecord>(
    (cursor) =>
      planeRequest<PlanePage<PlaneRecord>>(
        client,
        `${workItemsBase(client, projectId)}?${listQuery(pql, cursor)}`
      ),
    budget,
    INTEGRATION_PAGINATION_MAX_PAGES
  )
  const references = await resolveWorkItemReferences(client, projectId, raws)
  return raws.map((raw) => toWorkItem(raw, client, projectsById, references))
}

// Fetches work items for one connected Plane workspace. Plane's public REST API
// scopes work-item lists to a single project (there is no working workspace-wide
// list endpoint), so an omitted projectId ("all projects") fans out across every
// project in the workspace via the project-scoped route, bounded concurrency.
async function fetchWorkItemsForClient(
  client: PlaneClientForWorkspace,
  projectId: string | undefined,
  pql: string | undefined
): Promise<PlaneWorkItem[]> {
  const projectsById = await buildProjectsById(client)
  const projectIds = projectId ? [projectId] : [...projectsById.keys()]
  if (projectIds.length === 0) {
    return []
  }
  const fanout = await runBoundedIntegrationFanout(
    projectIds,
    (pid) => fetchProjectWorkItems(client, pid, pql, projectsById),
    (items) => items
  )
  return fanout.results.flat()
}

// Resolves the current user's id for one client so the assigned/created
// filters can match against it. Uses the in-memory viewer cache when present,
// otherwise fetches users/me once and caches it. Any failure resolves to null
// so the caller can degrade to the open set rather than surfacing an error.
async function resolveViewerId(client: PlaneClientForWorkspace): Promise<string | null> {
  const workspaceId = getPlaneWorkspaceId(client.baseUrl, client.workspaceSlug)
  const cached = getCachedViewer(workspaceId)
  if (cached) {
    return cached.id || null
  }
  try {
    const viewer = toViewer(await planeRequest<Record<string, unknown>>(client, USERS_ME_PATH))
    if (viewer.id) {
      setCachedViewer(workspaceId, viewer)
      return viewer.id
    }
    return null
  } catch {
    return null
  }
}

// Matches every state group so the list endpoint returns the complete set
// regardless of a tenant's no-pql default behavior (see listWorkItems).
const FETCH_ALL_STATES_PQL = 'stateGroup IN openStates() OR stateGroup IN closedStates()'

export async function listWorkItems(args: {
  projectId?: string
  filter: PlaneWorkItemFilter
  workspaceId?: PlaneWorkspaceSelection | null
}): Promise<PlaneWorkItem[]> {
  const entries = getClients(args.workspaceId)
  if (entries.length === 0) {
    return []
  }
  // Why: the fetch must retrieve EVERY state group, then filter client-side.
  // Some self-hosted Plane tenants return a limited default set when the list
  // request carries no `pql` param at all (e.g. only open items), yet return
  // the full set whenever any `pql` is present; other tenants ignore `pql`
  // entirely. Sending an all-states pql yields the complete set on both, so
  // filterPlaneWorkItems below is the single source of truth for narrowing.
  const pql = FETCH_ALL_STATES_PQL
  const items = await fetchAcrossClients(
    entries,
    args.workspaceId,
    async (client) => {
      const fetched = await fetchWorkItemsForClient(client, args.projectId, pql)
      const viewerId = filterNeedsViewer(args.filter) ? await resolveViewerId(client) : null
      return filterPlaneWorkItems(fetched, args.filter, viewerId)
    },
    true
  )
  return items.slice(0, INTEGRATION_PAGINATION_MAX_ITEMS)
}

// Why: the self-hosted REST v1 ignores ?pql=, so a server-side search returns
// every item (silently, with ok:true). Parse a supported query subset and
// filter client-side — throwing on anything unsupported so an unfiltered set is
// never mistaken for a filtered one — fetching the full set with an all-states
// pql the same way listWorkItems does.
export async function searchWorkItems(args: {
  query: string
  projectId?: string
  workspaceId?: PlaneWorkspaceSelection | null
}): Promise<PlaneWorkItem[]> {
  const entries = getClients(args.workspaceId)
  const query = args.query.trim()
  if (entries.length === 0 || !query) {
    return []
  }
  const clauses = parsePlaneQuery(query)
  const needsViewer = queryNeedsViewer(clauses)
  const items = await fetchAcrossClients(
    entries,
    args.workspaceId,
    async (client) => {
      const fetched = await fetchWorkItemsForClient(client, args.projectId, FETCH_ALL_STATES_PQL)
      const viewerId = needsViewer ? await resolveViewerId(client) : null
      return applyPlaneQuery(fetched, clauses, viewerId)
    },
    false
  )
  return items.slice(0, INTEGRATION_PAGINATION_MAX_ITEMS)
}

function retrievePath(
  client: PlaneClientForWorkspace,
  projectId: string,
  workItemId: string
): string {
  return `${workItemsBase(client, projectId)}${encodeURIComponent(workItemId)}/?expand=${encodeURIComponent(
    WORK_ITEM_EXPAND
  )}`
}

// UUID lookups need a project scope Plane's REST API has no workspace-wide
// "get by id" route (see Step 0 spike). Given projectId, retrieve directly;
// omitted, fan out across every project in the workspace (bounded,
// MAX_CONCURRENT=4) and 404 cleanly if none match.
async function retrieveByUuid(
  client: PlaneClientForWorkspace,
  workItemId: string,
  projectId: string | undefined
): Promise<PlaneWorkItem | null> {
  const projectsById = await buildProjectsById(client)
  const candidateIds = projectId ? [projectId] : [...projectsById.keys()]
  const fanout = await runBoundedIntegrationFanout(
    candidateIds,
    async (candidateId) => {
      try {
        const raw = await planeRequest<PlaneRecord>(
          client,
          retrievePath(client, candidateId, workItemId)
        )
        return toWorkItem(raw, client, projectsById)
      } catch (error) {
        if (error instanceof PlaneApiError && error.status === 404) {
          return null
        }
        throw error
      }
    },
    (result) => (result ? [result] : [])
  )
  return fanout.results.find((result): result is PlaneWorkItem => result !== null) ?? null
}

// PROJECT-N identifiers resolve directly against Plane's workspace-scoped
// retrieve-by-identifier route (verified in the Step 0 spike) -- no project
// UUID resolution needed at all, unlike the UUID path above.
async function retrieveByIdentifier(
  client: PlaneClientForWorkspace,
  identifier: string
): Promise<PlaneWorkItem | null> {
  const projectsById = await buildProjectsById(client)
  const workspace = `/api/v1/workspaces/${encodeURIComponent(client.workspaceSlug)}`
  try {
    const raw = await planeRequest<PlaneRecord>(
      client,
      `${workspace}/work-items/${encodeURIComponent(identifier)}/?expand=${encodeURIComponent(WORK_ITEM_EXPAND)}`
    )
    return toWorkItem(raw, client, projectsById)
  } catch (error) {
    if (error instanceof PlaneApiError && error.status === 404) {
      return null
    }
    throw error
  }
}

export async function getWorkItem(args: {
  workItemId: string
  projectId?: string
  workspaceId?: PlaneWorkspaceSelection | null
}): Promise<PlaneWorkItem | null> {
  const entries = getClients(args.workspaceId)
  const isIdentifier = IDENTIFIER_RE.test(args.workItemId)
  for (const client of entries) {
    await acquire()
    try {
      const found = isIdentifier
        ? await retrieveByIdentifier(client, args.workItemId)
        : await retrieveByUuid(client, args.workItemId, args.projectId)
      if (found) {
        return found
      }
    } catch (error) {
      clearWorkspaceTokenOnAuthError(client, error)
      throw error
    } finally {
      release()
    }
  }
  return null
}
