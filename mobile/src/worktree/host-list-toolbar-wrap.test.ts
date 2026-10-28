import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const source = readFileSync(new URL('../../app/h/[hostId]/index.tsx', import.meta.url), 'utf8')

describe('host list toolbar at large Dynamic Type', () => {
  // Why: at 375 pt and the capped size, Recent and Repo truncated to "Rec…" and "Re…".
  it('wraps its trailing icons onto a right-aligned row instead of truncating labels', () => {
    const start = source.indexOf('  toolbar: {')
    expect(start).toBeGreaterThanOrEqual(0)
    const toolbarStyle = source.slice(start, source.indexOf('}', start))

    expect(toolbarStyle).toContain("flexWrap: 'wrap'")
    expect(toolbarStyle).toContain("justifyContent: 'flex-end'")
  })
})
