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

// Why: upstream's auto-update "nudge" polls onorca.dev (which never announces
// this fork's -lab.N releases), so devs only saw updates on a manual check.
// Host the nudge in this fork's repo instead; the lab-release workflow rewrites
// whats-new/nudge.json each release (new id + maxVersion = prior version) so
// older installs get re-nudged to check, and the check resolves the newest
// release from the feed above. raw.githubusercontent serves the public repo.
export const UPDATE_NUDGE_URL = `https://raw.githubusercontent.com/${UPDATE_FEED_OWNER}/${UPDATE_FEED_REPO}/main/whats-new/nudge.json`

/** Fresh regex (own lastIndex) matching `href="…/releases/tag/<tag>"` entries. */
export function createReleaseTagHrefRegExp(): RegExp {
  const escapedBase = REPO_BASE.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`href="${escapedBase}/releases/tag/([^"]+)"`, 'g')
}
