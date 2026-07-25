import {
  acquire,
  clearWorkspaceTokenOnAuthError,
  planeRequest,
  PlaneApiError,
  release,
  type PlaneClientForWorkspace
} from './client'
import {
  INTEGRATION_PAGINATION_MAX_PAGES,
  IntegrationPaginationBudget
} from '../integration-pagination-budget'
import { fetchAllPlanePages, type PlanePage } from './plane-cursor-pagination'
import { resolveClient, toMutationError, type PlaneRecord } from './plane-work-item-writes'
import type {
  PlaneAddPlanningWorkItemsArgs,
  PlaneMutationResult,
  PlanePlanningContainer,
  PlanePlanningContainerArgs,
  PlanePlanningKind,
  PlanePlanningWorkItem,
  PlanePlanningWorkItemsArgs
} from '../../shared/plane-types'

function resourceName(kind: PlanePlanningKind): 'cycles' | 'modules' {
  return kind === 'cycle' ? 'cycles' : 'modules'
}

function resourceBase(
  client: PlaneClientForWorkspace,
  kind: PlanePlanningKind,
  projectId: string
): string {
  return `/api/v1/workspaces/${encodeURIComponent(client.workspaceSlug)}/projects/${encodeURIComponent(projectId)}/${resourceName(kind)}/`
}

function workItemsPath(client: PlaneClientForWorkspace, args: PlanePlanningWorkItemsArgs): string {
  const issueRoute = args.kind === 'cycle' ? 'cycle-issues' : 'module-issues'
  return `${resourceBase(client, args.kind, args.projectId)}${encodeURIComponent(args.containerId)}/${issueRoute}/`
}

function pagedPath(path: string, cursor: string | undefined): string {
  const params = new URLSearchParams({ per_page: '100' })
  if (cursor) {
    params.set('cursor', cursor)
  }
  return `${path}?${params.toString()}`
}

function stringValue(record: PlaneRecord, key: string): string | undefined {
  const value = record[key]
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function mapContainer(raw: PlaneRecord): PlanePlanningContainer {
  return {
    id: stringValue(raw, 'id') ?? '',
    name: stringValue(raw, 'name') ?? '',
    description: stringValue(raw, 'description'),
    startDate: stringValue(raw, 'start_date'),
    endDate: stringValue(raw, 'end_date'),
    targetDate: stringValue(raw, 'target_date'),
    status: stringValue(raw, 'status')
  }
}

function mapPlanningWorkItem(raw: PlaneRecord): PlanePlanningWorkItem {
  const issue = raw.issue
  const issueRecord = issue && typeof issue === 'object' ? (issue as PlaneRecord) : undefined
  const workItemId =
    (typeof issue === 'string' ? issue : undefined) ??
    (issueRecord ? stringValue(issueRecord, 'id') : undefined) ??
    stringValue(raw, 'id') ??
    ''
  const sequenceId =
    (issueRecord ? stringValue(issueRecord, 'identifier') : undefined) ??
    stringValue(raw, 'identifier')
  return {
    id: stringValue(raw, 'id') ?? workItemId,
    workItemId,
    title: (issueRecord ? stringValue(issueRecord, 'name') : undefined) ?? stringValue(raw, 'name'),
    identifier: sequenceId,
    createdAt: stringValue(raw, 'created_at')
  }
}

function requireClient(
  workspaceId: PlanePlanningContainerArgs['workspaceId']
): PlaneClientForWorkspace {
  const client = resolveClient(workspaceId)
  if (!client) {
    throw new PlaneApiError('Not connected to Plane.')
  }
  return client
}

async function listPaged<T>(
  client: PlaneClientForWorkspace,
  path: string,
  map: (raw: PlaneRecord) => T
): Promise<T[]> {
  const budget = new IntegrationPaginationBudget()
  const raws = await fetchAllPlanePages(
    (cursor) => planeRequest<PlanePage<PlaneRecord>>(client, pagedPath(path, cursor)),
    budget,
    INTEGRATION_PAGINATION_MAX_PAGES
  )
  return raws.map(map)
}

export async function listPlanningContainers(
  args: PlanePlanningContainerArgs
): Promise<PlanePlanningContainer[]> {
  const client = requireClient(args.workspaceId)
  await acquire()
  try {
    return await listPaged(client, resourceBase(client, args.kind, args.projectId), mapContainer)
  } catch (error) {
    clearWorkspaceTokenOnAuthError(client, error)
    throw error
  } finally {
    release()
  }
}

export async function listPlanningWorkItems(
  args: PlanePlanningWorkItemsArgs
): Promise<PlanePlanningWorkItem[]> {
  const client = requireClient(args.workspaceId)
  await acquire()
  try {
    return await listPaged(client, workItemsPath(client, args), mapPlanningWorkItem)
  } catch (error) {
    clearWorkspaceTokenOnAuthError(client, error)
    throw error
  } finally {
    release()
  }
}

export async function addPlanningWorkItems(
  args: PlaneAddPlanningWorkItemsArgs
): Promise<PlaneMutationResult> {
  const client = resolveClient(args.workspaceId)
  if (!client) {
    return { ok: false, error: 'Not connected to Plane.' }
  }
  await acquire()
  try {
    await planeRequest(client, workItemsPath(client, args), {
      method: 'POST',
      body: JSON.stringify({ issues: args.workItemIds })
    })
    return { ok: true }
  } catch (error) {
    clearWorkspaceTokenOnAuthError(client, error)
    return toMutationError(error, `Failed to add work items to ${args.kind}.`)
  } finally {
    release()
  }
}
