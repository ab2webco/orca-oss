import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const source = readFileSync(new URL('../components/HostListToolbar.tsx', import.meta.url), 'utf8')

describe('host list toolbar at large Dynamic Type', () => {
  // Why: at 375 pt and the capped size, Recent and Repo truncated to "Rec…" and "Re…".
  it('scrolls its chips horizontally instead of truncating labels', () => {
    const scrollStart = source.indexOf('<ScrollView')
    expect(scrollStart).toBeGreaterThanOrEqual(0)
    expect(source.slice(scrollStart, source.indexOf('>', scrollStart))).toContain('horizontal')
    expect(source).not.toContain('numberOfLines')
  })
})
