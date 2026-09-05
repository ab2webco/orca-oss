import type { PlaneCreateResult } from './plane-work-item-create'

export type PlaneBoardCreateState = {
  pending: boolean
  error: string | null
}

export const IDLE_PLANE_BOARD_CREATE: PlaneBoardCreateState = { pending: false, error: null }

export function beginPlaneBoardCreate(): PlaneBoardCreateState {
  return { pending: true, error: null }
}

export function settlePlaneBoardCreate(result: PlaneCreateResult): PlaneBoardCreateState {
  return result.ok ? IDLE_PLANE_BOARD_CREATE : { pending: false, error: result.error }
}

/** The title Plane will receive, or null when there is nothing to send. */
export function resolvePlaneBoardCreateTitle(raw: string): string | null {
  const title = raw.trim()
  return title ? title : null
}

export function canSubmitPlaneBoardCreate(state: PlaneBoardCreateState, raw: string): boolean {
  return !state.pending && resolvePlaneBoardCreateTitle(raw) !== null
}
