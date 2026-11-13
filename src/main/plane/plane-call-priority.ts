import { AsyncLocalStorage } from 'node:async_hooks'
import type { PlaneCallPriority } from './plane-rate-limiter'

const priority = new AsyncLocalStorage<PlaneCallPriority>()

/** Runs `fn` with every Plane call inside it queued at `level`. */
export function runWithPlanePriority<T>(level: PlaneCallPriority, fn: () => T): T {
  return priority.run(level, fn)
}

// Why interactive by default: the desktop's own reads (Tasks page, an opened ticket) carry no mark.
export const currentPlanePriority = (): PlaneCallPriority => priority.getStore() ?? 'interactive'

// Why: an unpaired RPC caller is an agent's `orca plane`; it queues behind the owner's own reads.
export const planeCallPriorityOf = (method: string, pairedDeviceId?: string): PlaneCallPriority =>
  method.startsWith('plane.') && !pairedDeviceId ? 'background' : 'interactive'

export const runPlaneCall = <T>(
  method: string,
  pairedDeviceId: string | undefined,
  fn: () => T
): T => runWithPlanePriority(planeCallPriorityOf(method, pairedDeviceId), fn)
