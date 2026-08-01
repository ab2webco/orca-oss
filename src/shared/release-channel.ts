import { compareAppVersions, isValidAppVersion } from './app-version'

export type ReleaseChannel = 'stable' | 'rc' | 'hourly'

export const RELEASE_CHANNELS: readonly ReleaseChannel[] = ['stable', 'rc', 'hourly']

/** Why the fork's own repo: every release surface derived from these constants —
 *  release-notes links, the dev build picker's listing, and the pinned generic
 *  feed resolveTargetBuild() hands the updater — must resolve where this fork
 *  actually publishes. Upstream's repo has no `-lab.N` tags, and pinning the
 *  updater at its assets would install an upstream build over a lab install.
 *  Keep in sync with src/main/update-feed-target.ts (shared/ cannot import main/).
 *  Upstream isolates hourly tags in a second repo so they never evict stable/RC
 *  entries from the 10-entry atom feed; the fork publishes no hourly tags, so
 *  hourly resolves here too and simply lists none. */
export const HOURLY_RELEASE_REPO = 'ab2webco/orca-oss'
export const MAIN_RELEASE_REPO = 'ab2webco/orca-oss'

export const HOURLY_PRERELEASE_IDENTIFIER = 'hourly'

export function isReleaseChannel(value: unknown): value is ReleaseChannel {
  return typeof value === 'string' && RELEASE_CHANNELS.includes(value as ReleaseChannel)
}

/**
 * Hourly builds are produced only by the macOS workflow, so the channel has
 * nothing to offer elsewhere. Shared so the picker, the main-process check, and
 * any future surface cannot drift on where it is available.
 */
export function isChannelSupportedOnPlatform(
  channel: ReleaseChannel,
  platform: NodeJS.Platform
): boolean {
  return channel !== 'hourly' || platform === 'darwin'
}

export function getReleaseRepoForChannel(channel: ReleaseChannel): string {
  return channel === 'hourly' ? HOURLY_RELEASE_REPO : MAIN_RELEASE_REPO
}

export function normalizeTagToVersion(tag: string): string {
  return tag.replace(/^v/i, '')
}

/** `1.4.160-hourly.202607281400` — a timestamp identifier keeps every build
 *  uniquely versioned so electron-updater never reads one as "same version". */
export function isHourlyVersion(version: string): boolean {
  return /^\d+\.\d+\.\d+-hourly\.\d{12}$/.test(normalizeTagToVersion(version))
}

export function formatHourlyVersion(baseVersion: string, stamp: string): string {
  return `${baseVersion}-${HOURLY_PRERELEASE_IDENTIFIER}.${stamp}`
}

/** Returns the build's UTC timestamp, or null when the version isn't hourly. */
export function parseHourlyVersionStamp(version: string): Date | null {
  const normalized = normalizeTagToVersion(version)
  // Why anchored on the whole version: an unanchored tail match also accepts
  // garbage prefixes, so `not-a-version-hourly.202601010000` would parse.
  const match = normalized.match(/^\d+\.\d+\.\d+-hourly\.(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})$/)
  if (!match) {
    return null
  }
  const [year, month, day, hour, minute] = match.slice(1).map(Number)
  const parsed = new Date(Date.UTC(year, month - 1, day, hour, minute))
  // Why the round-trip: Date.UTC silently rolls impossible dates forward, so a
  // corrupt `...hourly.202602300000` would render as March 2 rather than fail.
  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day ||
    parsed.getUTCHours() !== hour ||
    parsed.getUTCMinutes() !== minute
  ) {
    return null
  }
  return parsed
}

export function getVersionChannel(version: string): ReleaseChannel | null {
  const normalized = normalizeTagToVersion(version)
  if (!isValidAppVersion(normalized)) {
    return null
  }
  if (isHourlyVersion(normalized)) {
    return 'hourly'
  }
  return normalized.includes('-') ? 'rc' : 'stable'
}

/**
 * Release-notes page for a version, in whichever repo published it. Hourly tags
 * exist only in the hourly repo, so a main-repo tag URL for one 404s.
 * A null version falls back to the plain releases listing (not /releases/latest
 * — /latest also breaks when GitHub's API is degraded).
 */
export function getReleaseNotesUrlForVersion(version: string | null): string {
  const repo =
    version && getVersionChannel(version) === 'hourly' ? HOURLY_RELEASE_REPO : MAIN_RELEASE_REPO
  return version
    ? `https://github.com/${repo}/releases/tag/v${normalizeTagToVersion(version)}`
    : `https://github.com/${repo}/releases`
}

export type ReleaseBuild = {
  tag: string
  version: string
  channel: ReleaseChannel
  /** The release's GitHub title. Null when it is absent or just repeats the tag,
   *  so the picker can tell "the workflow named this" from "nobody did". */
  name: string | null
  publishedAt: string | null
  releaseUrl: string
}

/** Newest first, so the picker's first row is always the channel's current tip. */
export function sortReleaseBuildsNewestFirst(builds: ReleaseBuild[]): ReleaseBuild[] {
  return [...builds].sort((left, right) => compareAppVersions(right.version, left.version))
}
