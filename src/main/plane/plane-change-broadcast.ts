import type { BrowserWindow } from 'electron'

/**
 * Tells open Plane views that a work item changed, so they refetch instead of
 * showing stale cards until the user reloads.
 *
 * Why a broadcast and not a return value: the mutation that matters most is the
 * one an ORCHESTRATED AGENT makes through the CLI, which never touches the
 * renderer's own call path. Only main sees every mutation, whoever made it.
 */
const PLANE_CHANGED_CHANNEL = 'plane:changed'

/** RPC methods that alter what a Plane view renders. Read methods are excluded so
 *  a listing can never trigger the refetch that would list again. */
const PLANE_MUTATION_METHOD_NAMES = new Set([
  'plane.createWorkItem',
  'plane.updateWorkItem',
  'plane.addWorkItemComment',
  'plane.deleteWorkItemComment',
  'plane.createState',
  'plane.updateState',
  'plane.deleteState',
  'plane.addPlanningWorkItems',
  'plane.linkCurrentWorkItem',
  'plane.unlinkCurrentWorkItem'
])

export type PlaneChangeEvent = {
  /** RPC method that produced the change, for debugging a noisy refetch. */
  method: string
  /** Project whose views must refetch; null when the mutation is workspace-wide. */
  projectId: string | null
}

let broadcastWindow: BrowserWindow | null = null

export function attachPlaneChangeBroadcast(window: BrowserWindow | null): void {
  broadcastWindow = window
}

export function isPlaneMutationMethod(methodName: string): boolean {
  return PLANE_MUTATION_METHOD_NAMES.has(methodName)
}

/**
 * Reads the affected project from an RPC params object without trusting its shape:
 * params come from the CLI and remote clients, so a missing or non-string
 * projectId degrades to a workspace-wide notice rather than throwing.
 */
export function resolveChangedProjectId(params: unknown): string | null {
  if (!params || typeof params !== 'object') {
    return null
  }
  const projectId = (params as { projectId?: unknown }).projectId
  return typeof projectId === 'string' && projectId.length > 0 ? projectId : null
}

export function broadcastPlaneChange(event: PlaneChangeEvent): void {
  const window = broadcastWindow
  if (!window || window.isDestroyed()) {
    return
  }
  try {
    window.webContents.send(PLANE_CHANGED_CHANNEL, event)
  } catch (error) {
    // Why: a closing window must never fail the mutation that already succeeded.
    console.warn('[plane] Could not broadcast a Plane change:', error)
  }
}
