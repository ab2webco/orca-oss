import type { ChangelogData } from '../shared/update-status-types'
import { getReleaseNotesUrlForVersion } from '../shared/release-channel'
import { isValidVersion } from './updater-fallback'

/** Author-written copy for the release a nudge announces; the card shows it over the commit summary. */
export type NudgeContent = {
  /** The release the copy describes; the card only shows it for an offer of exactly this version. */
  version: string
  headline: string
  highlights: string[]
  link?: string
}

/** Keep in step with MAX_HIGHLIGHTS in config/scripts/write-update-nudge.mjs. */
export const MAX_NUDGE_HIGHLIGHTS = 3

function readLine(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null
  }
  const trimmed = value.trim()
  return trimmed ? trimmed : null
}

function isHttpsUrl(value: string): boolean {
  try {
    return new URL(value).protocol === 'https:'
  } catch {
    return false
  }
}

/**
 * A malformed block degrades to "no content" (a bad link alone is just dropped) so the nudge itself keeps firing.
 * Lenient on purpose: config/scripts/write-update-nudge.mjs is the strict gate at release time.
 */
export function parseNudgeContent(value: unknown): NudgeContent | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined
  }
  const { version, headline, highlights, link } = value as Record<string, unknown>
  const versionLine = readLine(version)
  if (!versionLine || !isValidVersion(versionLine)) {
    return undefined
  }
  const headlineLine = readLine(headline)
  if (!headlineLine) {
    return undefined
  }
  const highlightLines: string[] = []
  if (highlights !== undefined) {
    if (!Array.isArray(highlights)) {
      return undefined
    }
    for (const entry of highlights) {
      const line = readLine(entry)
      if (!line) {
        return undefined
      }
      // Why dedupe: the card keys list items by text.
      if (!highlightLines.includes(line)) {
        highlightLines.push(line)
      }
    }
  }
  const content: NudgeContent = {
    version: versionLine,
    headline: headlineLine,
    highlights: highlightLines.slice(0, MAX_NUDGE_HIGHLIGHTS)
  }
  if (typeof link === 'string' && isHttpsUrl(link.trim())) {
    content.link = link.trim()
  }
  return content
}

export function nudgeContentToChangelog(content: NudgeContent): ChangelogData {
  return {
    release: {
      title: content.headline,
      description: '',
      highlights: content.highlights,
      releaseNotesUrl: content.link ?? getReleaseNotesUrlForVersion(content.version)
    },
    // Why null: this fork's fetchChangelog never knows the count either, so nothing is lost by overriding.
    releasesBehind: null
  }
}
