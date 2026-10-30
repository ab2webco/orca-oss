import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const doc = readFileSync(
  join(
    resolve(import.meta.dirname, '../..'),
    'docs/reference/own-identity-and-services-decisions.md'
  ),
  'utf8'
)
const ownerRecord = '79c72dcf-633b-432d-a56d-fb2e9e36653c'

function atAGlanceRow(id) {
  return doc.split('\n').find((line) => line.startsWith(`| ${id} |`)) ?? ''
}

describe('own identity and services decisions (ORCA-329)', () => {
  it('cites the ORCA-329 comment that records the owner decisions', () => {
    expect(doc).toContain(ownerRecord)
  })

  it('marks D4 and D5 resolved with the current accounts kept', () => {
    for (const id of ['D4', 'D5']) {
      expect(atAGlanceRow(id)).toMatch(/Resolved/)
      expect(atAGlanceRow(id)).toMatch(/current account stays/)
    }
  })

  it('marks D1 to D3 paused until after the release', () => {
    for (const id of ['D1', 'D2', 'D3']) {
      expect(atAGlanceRow(id)).toMatch(/Paused until after the release/)
    }
  })

  // Why: the lead's brief said "under Ab2Web"; the owner's record does not.
  it('does not claim an Ab2Web enrollment or a stuck notarization', () => {
    expect(doc).not.toMatch(/under Ab2Web/i)
    expect(doc).not.toMatch(/notarization hangs|support case|stay on lab\.42/i)
  })
})
