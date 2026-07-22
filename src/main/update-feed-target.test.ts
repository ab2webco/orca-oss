import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  UPDATE_FEED_ATOM_URL,
  UPDATE_FEED_LATEST_DOWNLOAD_URL,
  UPDATE_FEED_OWNER,
  UPDATE_FEED_RELEASES_DOWNLOAD_BASE,
  UPDATE_FEED_REPO,
  createReleaseTagHrefRegExp
} from './update-feed-target'

// Why: this fork publishes its own -lab.N releases. If an upstream merge ever
// reverts the feed to stablyai/orca, installed lab builds would resolve
// upstream's higher stable semver and silently "update" users off the fork.
// This suite is the channel guard — it must fail loudly on any regression.
describe('update feed channel guard', () => {
  it('pins the feed to the fork, never upstream', () => {
    expect(UPDATE_FEED_OWNER).toBe('ab2webco')
    expect(UPDATE_FEED_REPO).toBe('orca-oss')
    for (const url of [
      UPDATE_FEED_ATOM_URL,
      UPDATE_FEED_RELEASES_DOWNLOAD_BASE,
      UPDATE_FEED_LATEST_DOWNLOAD_URL
    ]) {
      expect(url).toContain('github.com/ab2webco/orca-oss/')
      expect(url).not.toContain('stablyai')
    }
  })

  it('keeps the electron-builder publish target on the same channel', () => {
    // Why: the CJS builder config cannot import the TS feed module, so this
    // cross-check is what actually enforces the "keep in sync" contract.
    const builderConfig = readFileSync(
      resolve(__dirname, '../../config/electron-builder.config.cjs'),
      'utf8'
    )
    const publishBlock = builderConfig.slice(builderConfig.indexOf('publish:'))
    expect(publishBlock).toContain(`owner: '${UPDATE_FEED_OWNER}'`)
    expect(publishBlock).toContain(`repo: '${UPDATE_FEED_REPO}'`)
  })

  it('tag regex matches fork release hrefs only', () => {
    const regExp = createReleaseTagHrefRegExp()
    const forkHref = 'href="https://github.com/ab2webco/orca-oss/releases/tag/v1.4.150-rc.0.lab.2"'
    const upstreamHref = 'href="https://github.com/stablyai/orca/releases/tag/v1.4.150"'
    expect([...forkHref.matchAll(regExp)][0]?.[1]).toBe('v1.4.150-rc.0.lab.2')
    expect([...upstreamHref.matchAll(regExp)]).toHaveLength(0)
  })

  it('returns a fresh regex per call so shared lastIndex state cannot leak', () => {
    const first = createReleaseTagHrefRegExp()
    const second = createReleaseTagHrefRegExp()
    expect(first).not.toBe(second)
    expect(first.global).toBe(true)
  })
})
