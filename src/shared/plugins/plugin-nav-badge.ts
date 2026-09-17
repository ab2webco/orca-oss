/**
 * Badge counter for a `surface: 'nav'` panel entry in the left sidebar.
 *
 * Sin API nueva: el plugin ya escribe su propio KV con la capability
 * `storage`, asi que el contador viaja por una CLAVE RESERVADA de ese KV
 * (`navBadge`). El host la lee, nunca la escribe; el plugin la escribe como
 * cualquier otra clave suya.
 */

/** Reserved key inside the plugin's own `storage.json`. */
export const PLUGIN_NAV_BADGE_STORAGE_KEY = 'navBadge'

/** Above this the badge renders `99+` instead of the exact count. */
export const PLUGIN_NAV_BADGE_DISPLAY_MAX = 99

/**
 * Accepts `{ count: n }` or a bare number. Anything else — a string, a
 * fractional or non-finite number, a count of zero or less, a missing key —
 * means NO badge, never a dangling "0".
 */
export function parsePluginNavBadgeCount(value: unknown): number | null {
  const raw = readCandidateCount(value)
  if (raw === null || !Number.isSafeInteger(raw) || raw <= 0) {
    return null
  }
  return raw
}

function readCandidateCount(value: unknown): number | null {
  if (typeof value === 'number') {
    return value
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return null
  }
  // Own-key only: `{}` inheriting a `count` from its prototype is not a badge.
  if (!Object.hasOwn(value, 'count')) {
    return null
  }
  const count = (value as { count: unknown }).count
  return typeof count === 'number' ? count : null
}

/** Display text for an already-parsed count; capped at `99+`. */
export function formatPluginNavBadgeCount(count: number): string {
  return count > PLUGIN_NAV_BADGE_DISPLAY_MAX ? `${PLUGIN_NAV_BADGE_DISPLAY_MAX}+` : String(count)
}
