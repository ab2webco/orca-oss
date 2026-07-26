// Board-column (Plane state) create/rename IPC handlers, split from plane.ts to
// keep that file under the oxlint max-lines cap without a suppression.
import { ipcMain } from 'electron'
import {
  createPlaneState,
  deletePlaneState,
  updatePlaneState
} from '../plane/plane-work-item-writes'
import { createWorkItem } from '../plane/plane-work-item-create'
import type { PlaneStateGroup } from '../../shared/plane-types'

const VALID_STATE_GROUPS = new Set<PlaneStateGroup>([
  'backlog',
  'unstarted',
  'started',
  'completed',
  'cancelled'
])

function normalizeOptionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

export function registerPlaneBoardStateHandlers(): void {
  // Why here: the board's inline composer is the only renderer caller, and the
  // RPC surface already had plane.createWorkItem for the CLI — this exposes the
  // same write to the app without duplicating its logic.
  ipcMain.handle(
    'plane:createWorkItem',
    async (
      _event,
      args: { projectId: string; workspaceId?: string; title: string; stateId?: string }
    ) => {
      if (typeof args?.projectId !== 'string' || !args.projectId.trim()) {
        return { ok: false, error: 'Project is required.' }
      }
      const title = normalizeOptionalString(args?.title)
      if (!title) {
        return { ok: false, error: 'Work item title is required.' }
      }
      return createWorkItem({
        projectId: args.projectId.trim(),
        workspaceId: normalizeOptionalString(args.workspaceId),
        title,
        stateId: normalizeOptionalString(args.stateId)
      })
    }
  )

  ipcMain.handle(
    'plane:createState',
    async (
      _event,
      args: {
        projectId: string
        workspaceId?: string
        name: string
        group: PlaneStateGroup
        color?: string
      }
    ) => {
      if (typeof args?.projectId !== 'string' || !args.projectId.trim()) {
        return { ok: false, error: 'Project is required.' }
      }
      const name = normalizeOptionalString(args?.name)
      if (!name) {
        return { ok: false, error: 'Column name is required.' }
      }
      if (!VALID_STATE_GROUPS.has(args?.group)) {
        return { ok: false, error: 'A valid state group is required.' }
      }
      return createPlaneState({
        projectId: args.projectId.trim(),
        workspaceId: normalizeOptionalString(args.workspaceId),
        name,
        group: args.group,
        color: normalizeOptionalString(args.color)
      })
    }
  )

  ipcMain.handle(
    'plane:updateState',
    async (
      _event,
      args: {
        projectId: string
        stateId: string
        workspaceId?: string
        name?: string
        color?: string
        sequence?: number
      }
    ) => {
      if (typeof args?.projectId !== 'string' || !args.projectId.trim()) {
        return { ok: false, error: 'Project is required.' }
      }
      if (typeof args?.stateId !== 'string' || !args.stateId.trim()) {
        return { ok: false, error: 'State ID is required.' }
      }
      const name = normalizeOptionalString(args?.name)
      const color = normalizeOptionalString(args?.color)
      const sequence = typeof args?.sequence === 'number' ? args.sequence : undefined
      if (name === undefined && color === undefined && sequence === undefined) {
        return { ok: false, error: 'Nothing to update.' }
      }
      return updatePlaneState({
        projectId: args.projectId.trim(),
        stateId: args.stateId.trim(),
        workspaceId: normalizeOptionalString(args.workspaceId),
        name,
        color,
        sequence
      })
    }
  )

  ipcMain.handle(
    'plane:deleteState',
    async (_event, args: { projectId: string; stateId: string; workspaceId?: string }) => {
      if (typeof args?.projectId !== 'string' || !args.projectId.trim()) {
        return { ok: false, error: 'Project is required.' }
      }
      if (typeof args?.stateId !== 'string' || !args.stateId.trim()) {
        return { ok: false, error: 'State ID is required.' }
      }
      return deletePlaneState({
        projectId: args.projectId.trim(),
        stateId: args.stateId.trim(),
        workspaceId: normalizeOptionalString(args.workspaceId)
      })
    }
  )
}
