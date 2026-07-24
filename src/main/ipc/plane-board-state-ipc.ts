// Board-column (Plane state) create/rename IPC handlers, split from plane.ts to
// keep that file under the oxlint max-lines cap without a suppression.
import { ipcMain } from 'electron'
import { createPlaneState, updatePlaneState } from '../plane/plane-work-item-writes'
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
      if (name === undefined && color === undefined) {
        return { ok: false, error: 'Nothing to update.' }
      }
      return updatePlaneState({
        projectId: args.projectId.trim(),
        stateId: args.stateId.trim(),
        workspaceId: normalizeOptionalString(args.workspaceId),
        name,
        color
      })
    }
  )
}
