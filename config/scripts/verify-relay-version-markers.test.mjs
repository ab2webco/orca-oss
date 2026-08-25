import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { findRelayMarkerFailures } from './verify-relay-version-markers.mjs'

describe('relay version marker artifact check', () => {
  let relayRoot = ''

  const seedBundle = (platform, { marker = '0.1.0+abc123def456' } = {}) => {
    const dir = join(relayRoot, platform)
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'relay.js'), '// bundle')
    if (marker !== null) {
      writeFileSync(join(dir, '.version'), marker)
    }
  }

  beforeEach(() => {
    relayRoot = join(mkdtempSync(join(tmpdir(), 'relay-markers-')), 'relay')
  })

  afterEach(() => {
    rmSync(join(relayRoot, '..'), { recursive: true, force: true })
  })

  it('passes when every bundle directory carries a marker', () => {
    seedBundle('linux-x64')
    seedBundle('wsl')

    expect(findRelayMarkerFailures(relayRoot)).toEqual([])
  })

  // The exact shape upload-artifact produces without include-hidden-files.
  it('names every bundle whose dotfile marker was stripped', () => {
    seedBundle('linux-x64', { marker: null })
    seedBundle('darwin-arm64', { marker: null })

    const failures = findRelayMarkerFailures(relayRoot)

    expect(failures).toHaveLength(2)
    expect(failures.join('\n')).toContain('hidden files were stripped')
  })

  it('rejects an empty marker', () => {
    seedBundle('linux-x64', { marker: '  \n' })

    expect(findRelayMarkerFailures(relayRoot)).toEqual([expect.stringContaining('is empty')])
  })

  // Why: an absent tree must not read as "all markers present".
  it('fails when the relay tree is missing or holds no bundle', () => {
    expect(findRelayMarkerFailures(join(relayRoot, 'nope'))[0]).toContain('does not exist')

    mkdirSync(relayRoot, { recursive: true })
    expect(findRelayMarkerFailures(relayRoot)[0]).toContain('no relay bundle directory')
  })
})
