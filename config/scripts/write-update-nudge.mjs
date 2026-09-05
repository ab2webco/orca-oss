#!/usr/bin/env node
// Writes whats-new/nudge.json for a lab release. The optional content block comes
// from an announcement file the release author fills in by hand, never from
// commit subjects; src/main/updater-nudge-content.ts parses it and the update
// card lists it.
import { existsSync, readFileSync, writeFileSync } from 'node:fs'

// Keep in step with MAX_NUDGE_HIGHLIGHTS in src/main/updater-nudge-content.ts.
export const MAX_HIGHLIGHTS = 3
export const MAX_HEADLINE_LENGTH = 80
export const MAX_HIGHLIGHT_LENGTH = 120

const ALLOWED_KEYS = new Set(['headline', 'highlights', 'link'])

function isOneLine(value) {
  return typeof value === 'string' && value.trim().length > 0 && !/[\r\n]/.test(value)
}

/**
 * Strict on purpose: this runs before any build starts, so a typo fails the
 * dispatch instead of shipping a release whose card says nothing.
 * Returns null for a blank file (no announcement), the content otherwise.
 */
export function parseReleaseAnnouncement(text) {
  if (text.trim() === '') {
    return null
  }
  let parsed
  try {
    parsed = JSON.parse(text)
  } catch (error) {
    throw new Error(`announcement is not valid JSON: ${error.message}`)
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('announcement must be a JSON object')
  }
  const problems = []
  for (const key of Object.keys(parsed)) {
    if (!ALLOWED_KEYS.has(key)) {
      problems.push(`unknown key "${key}" (allowed: headline, highlights, link)`)
    }
  }
  const { headline, highlights, link } = parsed
  if (!isOneLine(headline)) {
    problems.push('headline must be a non-empty single line')
  } else if (headline.trim().length > MAX_HEADLINE_LENGTH) {
    problems.push(`headline must be at most ${MAX_HEADLINE_LENGTH} characters`)
  }
  if (highlights !== undefined) {
    if (!Array.isArray(highlights)) {
      problems.push('highlights must be an array of single-line strings')
    } else {
      if (highlights.length > MAX_HIGHLIGHTS) {
        problems.push(`highlights must have at most ${MAX_HIGHLIGHTS} entries`)
      }
      highlights.forEach((entry, index) => {
        if (!isOneLine(entry)) {
          problems.push(`highlights[${index}] must be a non-empty single line`)
        } else if (entry.trim().length > MAX_HIGHLIGHT_LENGTH) {
          problems.push(`highlights[${index}] must be at most ${MAX_HIGHLIGHT_LENGTH} characters`)
        } else if (highlights.slice(0, index).some((prior) => prior.trim() === entry.trim())) {
          problems.push(`highlights[${index}] repeats an earlier highlight`)
        }
      })
    }
  }
  if (link !== undefined) {
    let protocol = null
    try {
      protocol = typeof link === 'string' ? new URL(link).protocol : null
    } catch {
      protocol = null
    }
    if (protocol !== 'https:') {
      problems.push('link must be an https URL')
    }
  }
  if (problems.length > 0) {
    throw new Error(`announcement is invalid:\n${problems.map((p) => `  - ${p}`).join('\n')}`)
  }
  const content = {
    headline: headline.trim(),
    highlights: (highlights ?? []).map((entry) => entry.trim())
  }
  if (link !== undefined) {
    content.link = link.trim()
  }
  return content
}

/** A nudge without content is the baseline every older install must keep receiving. */
export function buildNudge({ version, prev, content }) {
  const nudge = { id: `orca-lab-${version}`, minVersion: '1.0.0', maxVersion: prev }
  if (content) {
    // Why version first: the card shows the copy only for an offer of exactly this release.
    nudge.content = { version, ...content }
  }
  return nudge
}

function readAnnouncementFile(path) {
  return existsSync(path) ? readFileSync(path, 'utf8') : ''
}

function main() {
  const args = process.argv.slice(2)
  const read = (flag) => {
    const index = args.indexOf(flag)
    return index === -1 ? null : args[index + 1]
  }
  const checkPath = read('--check')
  if (checkPath) {
    let content = null
    try {
      content = parseReleaseAnnouncement(readAnnouncementFile(checkPath))
    } catch (error) {
      console.error(`${checkPath}: ${error.message}`)
      process.exit(1)
    }
    console.log(
      content
        ? `announcement OK: "${content.headline}"`
        : 'no announcement (the nudge will carry no content)'
    )
    return
  }
  const version = read('--version')
  const prev = read('--prev')
  const announcementPath = read('--announcement')
  const out = read('--out')
  if (!version || !prev || !announcementPath || !out) {
    console.error(
      'usage: write-update-nudge.mjs --check <announcement>\n' +
        '       write-update-nudge.mjs --version <v> --prev <v> --announcement <file> --out <nudge.json>'
    )
    process.exit(2)
  }
  let content = null
  try {
    content = parseReleaseAnnouncement(readAnnouncementFile(announcementPath))
  } catch (error) {
    // Why warn instead of fail: assets are already published by now; a nudge
    // without content still reaches installs, a failed step reaches nobody.
    console.warn(`${error.message}\nwriting the nudge without content`)
  }
  writeFileSync(out, `${JSON.stringify(buildNudge({ version, prev, content }), null, 2)}\n`)
  console.log(
    content
      ? `nudge written with announcement "${content.headline}"`
      : 'nudge written without content'
  )
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main()
}
