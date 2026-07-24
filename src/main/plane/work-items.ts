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
  type PlaneClientForWorkspace
} from './client'
import { runBoundedIntegrationFanout } from '../integration-fanout'
import { boundedIntegrationErrorLog } from '../integration-error-message'
import {
  INTEGRATION_PAGINATION_MAX_ITEMS,
  INTEGRATION_PAGINATION_MAX_PAGES,
  IntegrationPaginationBudget
} from '../integration-pagination-budget'
import { fetchAllPlanePages, type PlanePage } from './plane-cursor-pagination'
import { listProjectsForClient } from './plane-work-item-reads'
import { filterToPql, mapPlaneWorkItem } from './plane-work-item-mappers'
import type {
  PlaneProject,
  PlaneWorkItem,
  PlaneWorkItemFilter,
  PlaneWorkspaceSelection
} from '../../shared/plane-types'

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
  const params = new URLSearchParams({ expand: WORK_ITEM_EXPAND, per_page: '100' })
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
  projectsById: Map<string, PlaneProject>
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
    project
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
  return raws.map((raw) => toWorkItem(raw, client, projectsById))
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

function shouldSurfaceFailure(
  selection: PlaneWorkspaceSelection | null | undefined,
  entryCount: number
): boolean {
  return selection !== 'all' && entryCount <= 1
}

// Fans out across connected Plane workspaces (getClients), bounded at
// MAX_CONCURRENT=4 by runBoundedIntegrationFanout, preserving entry order
// and truncating deterministically via the shared pagination budget.
// tolerateFailures mirrors Jira's multi-site search: a computed filter can
// swallow a single failing connection under 'all', but raw caller PQL
// (search) always surfaces its error so a bad query never fails silently.
async function fetchAcrossClients(
  entries: PlaneClientForWorkspace[],
  selection: PlaneWorkspaceSelection | null | undefined,
  load: (client: PlaneClientForWorkspace) => Promise<PlaneWorkItem[]>,
  tolerateFailures: boolean
): Promise<PlaneWorkItem[]> {
  const surfaceFailure = !tolerateFailures || shouldSurfaceFailure(selection, entries.length)
  const failures: Error[] = []
  const fanout = await runBoundedIntegrationFanout(
    entries,
    async (client) => {
      await acquire()
      try {
        return await load(client)
      } catch (error) {
        clearWorkspaceTokenOnAuthError(client, error)
        if (surfaceFailure) {
          throw error
        }
        console.warn('[plane] work item fan-out entry failed:', boundedIntegrationErrorLog(error))
        failures.push(error instanceof Error ? error : new Error(String(error)))
        return [] as PlaneWorkItem[]
      } finally {
        release()
      }
    },
    (items) => items
  )
  if (fanout.truncated) {
    console.warn(
      '[plane] Cross-workspace work items exceeded their aggregate result budget; truncating.'
    )
  }
  if (tolerateFailures && failures.length === entries.length && entries.length > 0) {
    throw failures[0]
  }
  return fanout.results.flat()
}

export async function listWorkItems(args: {
  projectId?: string
  filter: PlaneWorkItemFilter
  workspaceId?: PlaneWorkspaceSelection | null
}): Promise<PlaneWorkItem[]> {
  const entries = getClients(args.workspaceId)
  if (entries.length === 0) {
    return []
  }
  const pql = filterToPql(args.filter)
  const items = await fetchAcrossClients(
    entries,
    args.workspaceId,
    (client) => fetchWorkItemsForClient(client, args.projectId, pql),
    true
  )
  return items.slice(0, INTEGRATION_PAGINATION_MAX_ITEMS)
}

// Passes query through unmodified as raw PQL -- unlike listWorkItems, no
// server error is ever swallowed here (per-spec: "let Plane's 400 surface").
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
  const items = await fetchAcrossClients(
    entries,
    args.workspaceId,
    (client) => fetchWorkItemsForClient(client, args.projectId, query),
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
