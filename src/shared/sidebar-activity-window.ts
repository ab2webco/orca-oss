/** The windows the sidebar offers for "active" projects (ORCA-1216); the owner chose 24 h. */
export const SIDEBAR_ACTIVITY_WINDOW_HOURS = [12, 24, 72, 168] as const

export type SidebarActivityWindowHours = (typeof SIDEBAR_ACTIVITY_WINDOW_HOURS)[number]

export const DEFAULT_SIDEBAR_ACTIVITY_WINDOW_HOURS: SidebarActivityWindowHours = 24

const HOUR_MS = 60 * 60 * 1000

export function isSidebarActivityWindowHours(value: unknown): value is SidebarActivityWindowHours {
  return SIDEBAR_ACTIVITY_WINDOW_HOURS.some((hours) => hours === value)
}

export function getSidebarActivityWindowHours(
  settings: { sidebarActivityWindowHours?: SidebarActivityWindowHours } | null | undefined
): SidebarActivityWindowHours {
  const hours = settings?.sidebarActivityWindowHours
  return isSidebarActivityWindowHours(hours) ? hours : DEFAULT_SIDEBAR_ACTIVITY_WINDOW_HOURS
}

export function getSidebarActivityWindowMs(
  settings: { sidebarActivityWindowHours?: SidebarActivityWindowHours } | null | undefined
): number {
  return getSidebarActivityWindowHours(settings) * HOUR_MS
}
