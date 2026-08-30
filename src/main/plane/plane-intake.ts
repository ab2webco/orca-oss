import {
  acquire,
  clearWorkspaceTokenOnAuthError,
  planeRequest,
  release,
  type PlaneClientForWorkspace
} from './client'
import {
  INTEGRATION_PAGINATION_MAX_PAGES,
  IntegrationPaginationBudget
} from '../integration-pagination-budget'
import { boundedIntegrationErrorLog } from '../integration-error-message'
import { markdownToPlaneHtml } from './plane-html-markdown'
import { fetchAllPlanePages, type PlanePage } from './plane-cursor-pagination'
import { resolveClient, toMutationError, type PlaneRecord } from './plane-work-item-writes'
import type {
  PlaneCreateIntakeIssueArgs,
  PlaneCreateIntakeIssueResult,
  PlaneIntakeIssue,
  PlaneIntakeIssueStatus,
  PlaneListIntakeIssuesArgs,
  PlaneSetIntakeEnabledArgs,
  PlaneSetIntakeEnabledResult,
  PlaneWorkItemPriority
} from '../../shared/plane-types'

const INTAKE_STATUSES = new Set<number>([-2, -1, 0, 1, 2])
const PRIORITIES = new Set<PlaneWorkItemPriority>(['none', 'low', 'medium', 'high', 'urgent'])

function intakeBase(client: PlaneClientForWorkspace, projectId: string): string {
  return `/api/v1/workspaces/${encodeURIComponent(client.workspaceSlug)}/projects/${encodeURIComponent(projectId)}/intake-issues/`
}

function projectPath(client: PlaneClientForWorkspace, projectId: string): string {
  return `/api/v1/workspaces/${encodeURIComponent(client.workspaceSlug)}/projects/${encodeURIComponent(projectId)}/`
}

// Plane renamed the flag in v0.24 and made `inbox_view` a read-only response
// alias, then dropped it in v0.26. DRF silently discards both read-only and
// unknown keys, so sending the pair is safe on every version and the read-back
// below is what proves which one the server honoured.
function intakeFlagBody(enabled: boolean): PlaneRecord {
  return { intake_view: enabled, inbox_view: enabled }
}

function readIntakeFlag(project: PlaneRecord): boolean | undefined {
  if (typeof project.intake_view === 'boolean') {
    return project.intake_view
  }
  return typeof project.inbox_view === 'boolean' ? project.inbox_view : undefined
}

function pagedQuery(cursor: string | undefined): string {
  const params = new URLSearchParams({ per_page: '100' })
  if (cursor) {
    params.set('cursor', cursor)
  }
  return params.toString()
}

function nestedIssue(raw: PlaneRecord): PlaneRecord {
  if (raw.issue_detail && typeof raw.issue_detail === 'object') {
    return raw.issue_detail as PlaneRecord
  }
  return raw.issue && typeof raw.issue === 'object' ? (raw.issue as PlaneRecord) : raw
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function mapStatus(value: unknown): PlaneIntakeIssueStatus {
  return typeof value === 'number' && INTAKE_STATUSES.has(value)
    ? (value as PlaneIntakeIssueStatus)
    : 'unknown'
}

function mapPriority(value: unknown): PlaneWorkItemPriority | undefined {
  return typeof value === 'string' && PRIORITIES.has(value as PlaneWorkItemPriority)
    ? (value as PlaneWorkItemPriority)
    : undefined
}

function mapIntakeIssue(raw: PlaneRecord): PlaneIntakeIssue {
  const issue = nestedIssue(raw)
  const priority = mapPriority(issue.priority)
  return {
    id: optionalString(raw.id) ?? '',
    workItemId: optionalString(raw.issue) ?? optionalString(issue.id) ?? '',
    title: optionalString(issue.name) ?? 'Untitled intake item',
    ...(optionalString(issue.description_stripped) || optionalString(issue.description_html)
      ? {
          description:
            optionalString(issue.description_stripped) ?? optionalString(issue.description_html)
        }
      : {}),
    ...(priority ? { priority } : {}),
    status: mapStatus(raw.status),
    createdAt: optionalString(raw.created_at) ?? ''
  }
}

function createBody(args: PlaneCreateIntakeIssueArgs): PlaneRecord {
  const issue: PlaneRecord = { name: args.title }
  if (args.description !== undefined) {
    issue.description_html = markdownToPlaneHtml(args.description)
  }
  if (args.priority !== undefined) {
    issue.priority = args.priority
  }
  return { issue }
}

export async function createIntakeIssue(
  args: PlaneCreateIntakeIssueArgs
): Promise<PlaneCreateIntakeIssueResult> {
  const client = resolveClient(args.workspaceId)
  if (!client) {
    return { ok: false, error: 'Not connected to Plane.' }
  }
  await acquire()
  try {
    const raw = await planeRequest<PlaneRecord>(client, intakeBase(client, args.projectId), {
      method: 'POST',
      body: JSON.stringify(createBody(args))
    })
    return { ok: true, intakeIssue: mapIntakeIssue(raw) }
  } catch (error) {
    clearWorkspaceTokenOnAuthError(client, error)
    return toMutationError(error, 'Failed to create intake item.')
  } finally {
    release()
  }
}

export async function setIntakeEnabled(
  args: PlaneSetIntakeEnabledArgs
): Promise<PlaneSetIntakeEnabledResult> {
  const client = resolveClient(args.workspaceId)
  if (!client) {
    return { ok: false, error: 'Not connected to Plane.' }
  }
  await acquire()
  try {
    const updated = await planeRequest<PlaneRecord>(client, projectPath(client, args.projectId), {
      method: 'PATCH',
      body: JSON.stringify(intakeFlagBody(args.enabled))
    })
    const flag = readIntakeFlag(updated)
    if (flag === undefined) {
      return {
        ok: false,
        error: 'Plane accepted the update but reported no intake flag, so it could not be confirmed.'
      }
    }
    if (flag !== args.enabled) {
      return {
        ok: false,
        error: `Plane kept intake ${flag ? 'enabled' : 'disabled'}; this version may not accept the flag.`
      }
    }
    return { ok: true, enabled: flag }
  } catch (error) {
    clearWorkspaceTokenOnAuthError(client, error)
    return toMutationError(error, 'Failed to change the intake setting.')
  } finally {
    release()
  }
}

export async function listIntakeIssues(
  args: PlaneListIntakeIssuesArgs
): Promise<PlaneIntakeIssue[]> {
  const client = resolveClient(args.workspaceId)
  if (!client) {
    return []
  }
  await acquire()
  try {
    const budget = new IntegrationPaginationBudget()
    const raws = await fetchAllPlanePages<PlaneRecord>(
      (cursor) =>
        planeRequest<PlanePage<PlaneRecord>>(
          client,
          `${intakeBase(client, args.projectId)}?${pagedQuery(cursor)}`
        ),
      budget,
      INTEGRATION_PAGINATION_MAX_PAGES
    )
    return raws.map(mapIntakeIssue)
  } catch (error) {
    clearWorkspaceTokenOnAuthError(client, error)
    console.warn('[plane] listIntakeIssues failed:', boundedIntegrationErrorLog(error))
    return []
  } finally {
    release()
  }
}
