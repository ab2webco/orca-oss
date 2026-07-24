import { ipcMain } from 'electron'
import { connect } from '../plane/client'
import {
  disconnect,
  selectWorkspace,
  status,
  testConnection
} from '../plane/plane-connection-lifecycle'
import { getWorkItem, listWorkItems, searchWorkItems } from '../plane/work-items'
import {
  addWorkItemComment,
  listWorkItemComments,
  updateWorkItem
} from '../plane/plane-work-item-writes'
import { listLabels, listMembers, listProjects, listStates } from '../plane/plane-work-item-reads'
import { registerPlaneBoardStateHandlers } from './plane-board-state-ipc'
import { _resetPreflightCache } from './preflight'
import type { PlaneWorkItemFilter, PlaneWorkItemUpdate } from '../../shared/plane-types'

const VALID_FILTERS = new Set<PlaneWorkItemFilter>([
  'everything',
  'assigned',
  'created',
  'all',
  'done'
])
const VALID_PRIORITIES = new Set(['none', 'low', 'medium', 'high', 'urgent'])

function normalizeOptionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function normalizeStringArray(value: unknown): string[] | undefined {
  if (value === undefined) {
    return undefined
  }
  return Array.isArray(value) && value.every((item) => typeof item === 'string') ? value : undefined
}

function normalizeWorkItemUpdate(value: unknown): PlaneWorkItemUpdate | null {
  if (!value || typeof value !== 'object') {
    return null
  }
  const input = value as PlaneWorkItemUpdate
  if (input.title !== undefined && typeof input.title !== 'string') {
    return null
  }
  if (input.description !== undefined && typeof input.description !== 'string') {
    return null
  }
  if (input.labelIds !== undefined && normalizeStringArray(input.labelIds) === undefined) {
    return null
  }
  if (input.assigneeIds !== undefined && normalizeStringArray(input.assigneeIds) === undefined) {
    return null
  }
  if (input.priority !== undefined && !VALID_PRIORITIES.has(input.priority)) {
    return null
  }
  if (input.stateId !== undefined && typeof input.stateId !== 'string') {
    return null
  }
  if (input.startDate !== undefined && typeof input.startDate !== 'string') {
    return null
  }
  if (input.targetDate !== undefined && typeof input.targetDate !== 'string') {
    return null
  }
  if (
    input.parentId !== undefined &&
    input.parentId !== null &&
    typeof input.parentId !== 'string'
  ) {
    return null
  }
  return input
}

export function registerPlaneHandlers(): void {
  ipcMain.handle(
    'plane:connect',
    async (_event, args: { baseUrl: string; workspaceSlug: string; apiKey: string }) => {
      if (
        typeof args?.baseUrl !== 'string' ||
        !args.baseUrl.trim() ||
        typeof args?.workspaceSlug !== 'string' ||
        !args.workspaceSlug.trim() ||
        typeof args?.apiKey !== 'string' ||
        !args.apiKey.trim()
      ) {
        return { ok: false, error: 'Base URL, workspace slug, and API key are required.' }
      }
      const result = await connect({
        baseUrl: args.baseUrl,
        workspaceSlug: args.workspaceSlug,
        apiKey: args.apiKey
      })
      if (result.ok) {
        _resetPreflightCache()
      }
      return result
    }
  )

  ipcMain.handle('plane:disconnect', async (_event, args?: { workspaceId?: string }) => {
    const workspaceId = normalizeOptionalString(args?.workspaceId)
    disconnect(workspaceId ? { workspaceId } : undefined)
    _resetPreflightCache()
  })

  ipcMain.handle('plane:selectWorkspace', async (_event, args: { workspaceId: string }) => {
    const workspaceId = normalizeOptionalString(args?.workspaceId)
    if (!workspaceId) {
      return status()
    }
    return selectWorkspace({ workspaceId })
  })

  ipcMain.handle('plane:status', async () => {
    return status()
  })

  ipcMain.handle('plane:testConnection', async (_event, args?: { workspaceId?: string }) => {
    return testConnection({ workspaceId: normalizeOptionalString(args?.workspaceId) })
  })

  ipcMain.handle(
    'plane:listWorkItems',
    async (
      _event,
      args?: { projectId?: string; filter?: PlaneWorkItemFilter; workspaceId?: string }
    ) => {
      const filter = VALID_FILTERS.has(args?.filter as PlaneWorkItemFilter)
        ? (args!.filter as PlaneWorkItemFilter)
        : 'all'
      return listWorkItems({
        projectId: normalizeOptionalString(args?.projectId),
        filter,
        workspaceId: normalizeOptionalString(args?.workspaceId)
      })
    }
  )

  ipcMain.handle(
    'plane:searchWorkItems',
    async (_event, args?: { query?: string; projectId?: string; workspaceId?: string }) => {
      if (typeof args?.query !== 'string' || !args.query.trim()) {
        return []
      }
      return searchWorkItems({
        query: args.query.trim(),
        projectId: normalizeOptionalString(args.projectId),
        workspaceId: normalizeOptionalString(args.workspaceId)
      })
    }
  )

  ipcMain.handle(
    'plane:getWorkItem',
    async (_event, args?: { workItemId?: string; projectId?: string; workspaceId?: string }) => {
      if (typeof args?.workItemId !== 'string' || !args.workItemId.trim()) {
        return null
      }
      return getWorkItem({
        workItemId: args.workItemId.trim(),
        projectId: normalizeOptionalString(args.projectId),
        workspaceId: normalizeOptionalString(args.workspaceId)
      })
    }
  )

  ipcMain.handle(
    'plane:updateWorkItem',
    async (
      _event,
      args: {
        projectId: string
        workItemId: string
        workspaceId?: string
        updates: PlaneWorkItemUpdate
      }
    ) => {
      if (typeof args?.projectId !== 'string' || !args.projectId.trim()) {
        return { ok: false, error: 'Project is required.' }
      }
      if (typeof args?.workItemId !== 'string' || !args.workItemId.trim()) {
        return { ok: false, error: 'Work item ID is required.' }
      }
      const updates = normalizeWorkItemUpdate(args.updates)
      if (!updates) {
        return { ok: false, error: 'Updates object is required.' }
      }
      return updateWorkItem({
        projectId: args.projectId.trim(),
        workItemId: args.workItemId.trim(),
        workspaceId: normalizeOptionalString(args.workspaceId),
        updates
      })
    }
  )

  ipcMain.handle(
    'plane:addWorkItemComment',
    async (
      _event,
      args: { projectId: string; workItemId: string; body: string; workspaceId?: string }
    ) => {
      if (typeof args?.projectId !== 'string' || !args.projectId.trim()) {
        return { ok: false, error: 'Project is required.' }
      }
      if (typeof args?.workItemId !== 'string' || !args.workItemId.trim()) {
        return { ok: false, error: 'Work item ID is required.' }
      }
      if (typeof args?.body !== 'string' || !args.body.trim()) {
        return { ok: false, error: 'Comment body is required.' }
      }
      return addWorkItemComment({
        projectId: args.projectId.trim(),
        workItemId: args.workItemId.trim(),
        body: args.body.trim(),
        workspaceId: normalizeOptionalString(args.workspaceId)
      })
    }
  )

  ipcMain.handle(
    'plane:listWorkItemComments',
    async (_event, args?: { projectId?: string; workItemId?: string; workspaceId?: string }) => {
      if (typeof args?.projectId !== 'string' || !args.projectId.trim()) {
        return []
      }
      if (typeof args?.workItemId !== 'string' || !args.workItemId.trim()) {
        return []
      }
      return listWorkItemComments({
        projectId: args.projectId.trim(),
        workItemId: args.workItemId.trim(),
        workspaceId: normalizeOptionalString(args.workspaceId)
      })
    }
  )

  registerPlaneBoardStateHandlers()

  ipcMain.handle('plane:listProjects', async (_event, args?: { workspaceId?: string }) => {
    return listProjects(normalizeOptionalString(args?.workspaceId))
  })

  ipcMain.handle(
    'plane:listStates',
    async (_event, args?: { projectId?: string; workspaceId?: string }) => {
      if (typeof args?.projectId !== 'string' || !args.projectId.trim()) {
        return []
      }
      return listStates(args.projectId.trim(), normalizeOptionalString(args.workspaceId))
    }
  )

  ipcMain.handle(
    'plane:listLabels',
    async (_event, args?: { projectId?: string; workspaceId?: string }) => {
      if (typeof args?.projectId !== 'string' || !args.projectId.trim()) {
        return []
      }
      return listLabels(args.projectId.trim(), normalizeOptionalString(args.workspaceId))
    }
  )

  ipcMain.handle(
    'plane:listMembers',
    async (_event, args?: { workspaceId?: string; projectId?: string }) => {
      return listMembers(
        normalizeOptionalString(args?.workspaceId),
        normalizeOptionalString(args?.projectId)
      )
    }
  )
}
