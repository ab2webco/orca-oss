// The ids outlive their labels on purpose: one is already stored in every user's
// settings, and renaming them would silently reset the choice to the default.
export const APP_ICON_OPTIONS = [
  { id: 'classic', label: 'Ab2Web Orange' },
  { id: 'watercolor', label: 'Monochrome' },
  { id: 'blue', label: 'Violet' }
] as const

export type AppIconId = (typeof APP_ICON_OPTIONS)[number]['id']

export const DEFAULT_APP_ICON_ID: AppIconId = 'classic'

export function normalizeAppIconId(value: unknown): AppIconId {
  return APP_ICON_OPTIONS.some((option) => option.id === value)
    ? (value as AppIconId)
    : DEFAULT_APP_ICON_ID
}
