import { net } from 'electron'
import type { ChangelogData } from '../shared/types'
import {
  MAIN_RELEASE_REPO,
  getReleaseNotesUrlForVersion,
  getReleaseRepoForChannel,
  getVersionChannel,
  normalizeTagToVersion
} from '../shared/release-channel'

const FETCH_TIMEOUT_MS = 5000

/** A single `<p>` in the update card, so the summary stays short. */
const MAX_DESCRIPTION_BULLETS = 4
const MAX_DESCRIPTION_LENGTH = 280

// Why: `.github/workflows/lab-release.yml` writes every release body with a
// `## Cambios desde <prev tag>` section holding one `- <commit subject>` line
// per change. That section is the only part of the notes worth surfacing —
// the rest is the same boilerplate on every release.
const CHANGES_HEADING = /^##\s+Cambios desde\b/
const NEXT_HEADING = /^#{1,6}\s/
const BULLET = /^[-*]\s+(.+)$/

type GitHubRelease = {
  name?: unknown
  body?: unknown
  html_url?: unknown
  draft?: unknown
}

export function getReleaseApiUrlForVersion(version: string): string {
  const channel = getVersionChannel(version)
  const repo = channel ? getReleaseRepoForChannel(channel) : MAIN_RELEASE_REPO
  const tag = `v${normalizeTagToVersion(version)}`
  return `https://api.github.com/repos/${repo}/releases/tags/${encodeURIComponent(tag)}`
}

function truncate(text: string): string {
  return text.length > MAX_DESCRIPTION_LENGTH
    ? `${text.slice(0, MAX_DESCRIPTION_LENGTH - 1).trimEnd()}…`
    : text
}

/**
 * Condenses the release body into the one paragraph the card renders: the
 * change bullets when the notes carry them, otherwise the release's own lead
 * paragraph. Returns '' when neither is present, which leaves the card plain
 * rather than showing a heading or the install boilerplate.
 */
export function summarizeReleaseBody(body: string): string {
  const lines = body.split('\n')
  const changesStart = lines.findIndex((line) => CHANGES_HEADING.test(line.trim()))
  if (changesStart !== -1) {
    const bullets: string[] = []
    for (const line of lines.slice(changesStart + 1)) {
      const trimmed = line.trim()
      if (NEXT_HEADING.test(trimmed)) {
        break
      }
      const bullet = trimmed.match(BULLET)
      if (bullet) {
        bullets.push(bullet[1].trim())
      }
    }
    if (bullets.length > 0) {
      const shown = bullets.slice(0, MAX_DESCRIPTION_BULLETS)
      const joined = shown.join(' · ')
      return truncate(bullets.length > shown.length ? `${joined} …` : joined)
    }
  }

  // Why skip headings and blockquotes: the lead is `# <title>` followed by a
  // versioning aside, neither of which reads as a change summary.
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('>')) {
      continue
    }
    return truncate(trimmed)
  }
  return ''
}

/**
 * Builds the post-update "What's New" card from this fork's own GitHub release
 * for the version being offered.
 *
 * Why the release rather than a changelog file we publish: the lab release
 * workflow already writes per-release notes listing the commits in that build,
 * so the release is the only source that cannot go stale — a checked-in JSON
 * would silently describe the previous build the first time someone forgets to
 * update it.
 *
 * Why net.fetch instead of fetch: Electron's `net` module respects the app's
 * proxy/certificate settings and has no CORS restrictions.
 *
 * Returns null whenever the release is unreachable, unpublished or carries
 * nothing worth showing; the caller then renders the plain version card.
 */
export async function fetchChangelog(incomingVersion: string): Promise<ChangelogData | null> {
  const res = await net.fetch(getReleaseApiUrlForVersion(incomingVersion), {
    headers: { Accept: 'application/vnd.github+json' },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS)
  })
  if (!res.ok) {
    return null
  }
  const json: unknown = await res.json()
  if (!json || typeof json !== 'object' || Array.isArray(json)) {
    return null
  }
  const release = json as GitHubRelease
  if (release.draft === true) {
    return null
  }

  const description = typeof release.body === 'string' ? summarizeReleaseBody(release.body) : ''
  if (!description) {
    return null
  }
  const name = typeof release.name === 'string' ? release.name.trim() : ''
  const releaseNotesUrl =
    typeof release.html_url === 'string' && release.html_url
      ? release.html_url
      : getReleaseNotesUrlForVersion(incomingVersion)

  return {
    release: {
      title: name || `Orca ${normalizeTagToVersion(incomingVersion)}`,
      description,
      releaseNotesUrl
    },
    // Why null: a single release cannot say how many the user skipped, and the
    // card simply omits its "+N more since your last update" link.
    releasesBehind: null
  }
}
