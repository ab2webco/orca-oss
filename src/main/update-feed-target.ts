// Why: single source of truth for the GitHub repo the auto-updater checks.
// This fork publishes its own `-lab.N` releases to ab2webco/orca-oss, so the
// feed must point here instead of upstream stablyai/orca — otherwise a fork
// build would resolve upstream's higher stable semver and "update" users off
// the fork. Keep in sync with the `publish` block in
// config/electron-builder.config.cjs (that file is CJS and cannot import this).
export const UPDATE_FEED_OWNER = 'ab2webco'
export const UPDATE_FEED_REPO = 'orca-oss'

const REPO_BASE = `https://github.com/${UPDATE_FEED_OWNER}/${UPDATE_FEED_REPO}`

/** Atom feed listing every release (prerelease + stable), unfiltered. */
export const UPDATE_FEED_ATOM_URL = `${REPO_BASE}/releases.atom`

/** Base for per-tag release asset downloads: `${base}/<tag>/<asset>`. */
export const UPDATE_FEED_RELEASES_DOWNLOAD_BASE = `${REPO_BASE}/releases/download`

/** Generic-provider feed pinned at the newest published release's assets. */
export const UPDATE_FEED_LATEST_DOWNLOAD_URL = `${REPO_BASE}/releases/latest/download`

/** Fresh regex (own lastIndex) matching `href="…/releases/tag/<tag>"` entries. */
export function createReleaseTagHrefRegExp(): RegExp {
  const escapedBase = REPO_BASE.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`href="${escapedBase}/releases/tag/([^"]+)"`, 'g')
}
