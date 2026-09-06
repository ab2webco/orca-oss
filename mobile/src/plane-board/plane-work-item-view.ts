import { useCallback, useEffect, useRef, useState } from 'react'
import AsyncStorage from '@react-native-async-storage/async-storage'

// Mirrors the desktop Linear view model (issue-view-resume-state.ts): list and board
// are two views of the same work items, and which one is open is a per-device
// preference, never host state.
export const PLANE_VIEW_MODES = ['list', 'board'] as const
export type PlaneViewMode = (typeof PLANE_VIEW_MODES)[number]
export const DEFAULT_PLANE_VIEW_MODE: PlaneViewMode = 'list'

export type PlaneWorkItemView = {
  viewMode: PlaneViewMode
}

const STORAGE_KEY = 'orca:plane.work-item-view.v1'

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function isPlaneViewMode(value: unknown): value is PlaneViewMode {
  return typeof value === 'string' && (PLANE_VIEW_MODES as readonly string[]).includes(value)
}

export function defaultPlaneWorkItemView(): PlaneWorkItemView {
  return { viewMode: DEFAULT_PLANE_VIEW_MODE }
}

/** Tolerates junk: an unknown mode, a bare string, or a corrupt record all read as the default. */
export function resolvePlaneWorkItemView(raw: unknown): PlaneWorkItemView {
  if (!isPlainObject(raw)) {
    return defaultPlaneWorkItemView()
  }
  return { viewMode: isPlaneViewMode(raw.viewMode) ? raw.viewMode : DEFAULT_PLANE_VIEW_MODE }
}

/** Undefined for an all-defaults view, so resetting clears the key instead of
 *  pinning today's default against a future change. */
export function normalizePlaneWorkItemView(view: PlaneWorkItemView): PlaneWorkItemView | undefined {
  return view.viewMode === DEFAULT_PLANE_VIEW_MODE ? undefined : { viewMode: view.viewMode }
}

export async function loadPlaneWorkItemView(): Promise<PlaneWorkItemView> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY)
    return resolvePlaneWorkItemView(raw ? (JSON.parse(raw) as unknown) : undefined)
  } catch {
    return defaultPlaneWorkItemView()
  }
}

export async function savePlaneWorkItemView(view: PlaneWorkItemView): Promise<void> {
  try {
    const normalized = normalizePlaneWorkItemView(view)
    if (!normalized) {
      await AsyncStorage.removeItem(STORAGE_KEY)
      return
    }
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(normalized))
  } catch {
    // The live view stays usable when device storage is unavailable or full.
  }
}

/** The persisted view mode. Starts on the default and adopts the stored one once it
 *  loads, unless the user already picked a mode in the meantime. */
export function usePlaneViewMode(): [PlaneViewMode, (mode: PlaneViewMode) => void] {
  const [viewMode, setViewModeState] = useState<PlaneViewMode>(DEFAULT_PLANE_VIEW_MODE)
  const touchedRef = useRef(false)

  useEffect(() => {
    let stale = false
    void loadPlaneWorkItemView().then((view) => {
      if (!stale && !touchedRef.current) {
        setViewModeState(view.viewMode)
      }
    })
    return () => {
      stale = true
    }
  }, [])

  const setViewMode = useCallback((mode: PlaneViewMode) => {
    touchedRef.current = true
    setViewModeState(mode)
    void savePlaneWorkItemView({ viewMode: mode })
  }, [])

  return [viewMode, setViewMode]
}
