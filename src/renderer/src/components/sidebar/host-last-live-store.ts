import { useSyncExternalStore } from 'react'
import type { StoreApi } from 'zustand'
import type { AppState } from '@/store/types'
import type { ExecutionHostId } from '../../../../shared/execution-host'
import type { ExecutionHostHealth } from '../../../../shared/execution-host-registry'
import { getHostDisplayLabelOverrides } from '../../../../shared/host-setting-overrides'
import { buildSidebarHostOptions } from './sidebar-host-options'

/**
 * When each host last had live data, for the offline host card's age (ORCA-1181).
 * Why session-only: no host reports a last-seen time, so the renderer stamps the moment it
 * sees a connected host drop; a host never seen connected this session has no age at all.
 */
export type HostLiveObservation = {
  lastLiveAt: ReadonlyMap<ExecutionHostId, number>
  lastHealth: ReadonlyMap<ExecutionHostId, ExecutionHostHealth>
}

type ObservedHost = { id: ExecutionHostId; health: ExecutionHostHealth }

export const EMPTY_HOST_LIVE_OBSERVATION: HostLiveObservation = {
  lastLiveAt: new Map(),
  lastHealth: new Map()
}

export function observeHostHealth(
  previous: HostLiveObservation,
  hosts: readonly ObservedHost[],
  now: number
): HostLiveObservation {
  const lastLiveAt = new Map(previous.lastLiveAt)
  const lastHealth = new Map(previous.lastHealth)
  for (const host of hosts) {
    if (host.health === 'available' || previous.lastHealth.get(host.id) === 'available') {
      lastLiveAt.set(host.id, now)
    }
    lastHealth.set(host.id, host.health)
  }
  return { lastLiveAt, lastHealth }
}

let observation = EMPTY_HOST_LIVE_OBSERVATION
const listeners = new Set<() => void>()
let tracking = false

export function recordHostHealth(hosts: readonly ObservedHost[], now: number): void {
  const next = observeHostHealth(observation, hosts, now)
  const changed = hosts.some(
    (host) => next.lastLiveAt.get(host.id) !== observation.lastLiveAt.get(host.id)
  )
  observation = next
  if (changed) {
    for (const listener of listeners) {
      listener()
    }
  }
}

export function getHostLastLiveAt(hostId: ExecutionHostId): number | null {
  return observation.lastLiveAt.get(hostId) ?? null
}

export function resetHostLastLive(): void {
  observation = EMPTY_HOST_LIVE_OBSERVATION
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function useHostLastLiveAt(hostId: ExecutionHostId): number | null {
  const getSnapshot = (): number | null => getHostLastLiveAt(hostId)
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}

function observeStore(state: AppState): void {
  recordHostHealth(
    buildSidebarHostOptions({
      repos: state.repos,
      sshTargetLabels: state.sshTargetLabels,
      sshConnectionStates: state.sshConnectionStates,
      settings: state.settings,
      runtimeEnvironments: state.runtimeEnvironments,
      runtimeStatusByEnvironmentId: state.runtimeStatusByEnvironmentId,
      hostLabelOverrides: getHostDisplayLabelOverrides(state.settings)
    }),
    Date.now()
  )
}

/** Starts the session-long watch once; it outlives the sidebar so a drop while it is closed still stamps. */
export function ensureHostLastLiveTracking(
  store: Pick<StoreApi<AppState>, 'getState' | 'subscribe'>
): void {
  if (tracking) {
    return
  }
  tracking = true
  observeStore(store.getState())
  store.subscribe((state, previous) => {
    if (
      state.sshConnectionStates !== previous.sshConnectionStates ||
      state.runtimeStatusByEnvironmentId !== previous.runtimeStatusByEnvironmentId ||
      state.repos !== previous.repos
    ) {
      observeStore(state)
    }
  })
}
