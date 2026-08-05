import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'
import {
  withAdhocEnv,
  withEnv,
  withHourlyEnv
} from './electron-builder-build-env-fixture.mjs'

const require = createRequire(import.meta.url)
const electronBuilderConfig = require('../electron-builder.config.cjs')

// Why its own file: release identity (where a build publishes, and as what) is the one
// packaging decision a fork must never inherit from upstream, so it reads on its own.
describe('electron-builder release identity', () => {
  it('builds hourly artifacts with the release signing identity', () => {
    withHourlyEnv((config) => {
      expect(config.mac.appId).toBeUndefined()
      expect(config.appId).toBe('com.stablyai.orca')
      expect(config.mac.hardenedRuntime).toBe(true)
      expect(config.forceCodeSigning).toBe(true)
    })
  })

  // Why hourly must notarize despite the round trip: TCC anchors a notarized
  // Developer ID app's grants on identifier + team, not on its cdhash, so they
  // survive an update. An unnotarized hourly reads as a new client every build
  // and loses file access under Documents/Desktop/Downloads with no re-prompt.
  it('notarizes hourly builds like releases, and neither locally', () => {
    withHourlyEnv((config) => {
      expect(config.mac.notarize).toBe(true)
    })
    withEnv({ ORCA_MAC_RELEASE: '1' }, (config) => {
      expect(config.mac.notarize).toBe(true)
    })
    expect(electronBuilderConfig.mac.notarize).toBe(false)
  })

  // Why: this fork publishes its own `-lab.N` releases, so the publish target must
  // stay ab2webco/orca-oss — pointing it at upstream would both fail to publish and
  // let a fork build resolve upstream's higher stable semver. Keep in sync with
  // src/main/update-feed-target.ts and src/shared/release-channel.ts.
  // Upstream isolates each dev channel's tags in its own repo because the main repo's
  // releases atom feed exposes only its 10 newest entries; the fork publishes no
  // hourly/adhoc tags, so both stay in the one repo and are downgraded to prereleases.
  it('publishes to the fork and keeps hourly builds out of the Latest pointer', () => {
    withHourlyEnv((config) => {
      expect(config.publish).toMatchObject({
        owner: 'ab2webco',
        repo: 'orca-oss',
        releaseType: 'prerelease'
      })
    })
    expect(electronBuilderConfig.publish).toMatchObject({
      owner: 'ab2webco',
      repo: 'orca-oss',
      releaseType: 'release'
    })
  })

  // Why: a release candidate must be born a prerelease — finalize's --prerelease
  // lands only after every platform job, and until then a full release would hold
  // GitHub's Latest pointer for installs that were never meant to see it.
  it('publishes a lab release candidate as a prerelease', () => {
    withEnv({ ORCA_LAB_RELEASE_CANDIDATE: '1' }, (config) => {
      expect(config.publish).toMatchObject({
        owner: 'ab2webco',
        repo: 'orca-oss',
        releaseType: 'prerelease'
      })
    })
  })

  it('stamps hourly packages with the hourly version', () => {
    withEnv(
      { ORCA_MAC_HOURLY: '1', ORCA_HOURLY_BUILD_VERSION: '1.4.160-hourly.202607281400' },
      (config) => {
        expect(config.extraMetadata).toEqual({ version: '1.4.160-hourly.202607281400' })
      }
    )
  })

  // Why adhoc carries the identical mac identity to hourly: it installs over a
  // real Orca through the same updater path, so the same signing and the same TCC
  // argument apply.
  it('builds adhoc artifacts with the release identity and the fork repo', () => {
    withAdhocEnv((config) => {
      expect(config.appId).toBe('com.stablyai.orca')
      expect(config.mac.hardenedRuntime).toBe(true)
      expect(config.mac.notarize).toBe(true)
      expect(config.forceCodeSigning).toBe(true)
      expect(config.publish).toMatchObject({
        owner: 'ab2webco',
        repo: 'orca-oss',
        releaseType: 'prerelease'
      })
    })
  })

  it('stamps adhoc packages with the adhoc version', () => {
    withEnv(
      { ORCA_MAC_ADHOC: '1', ORCA_ADHOC_BUILD_VERSION: '1.4.160-adhoc.20260728140533' },
      (config) => {
        expect(config.extraMetadata).toEqual({ version: '1.4.160-adhoc.20260728140533' })
      }
    )
  })

  // Why the fork inverts upstream's separate-repos rule: neither dev workflow runs
  // here (both are gated on `github.repository == 'stablyai/orca'`), so the guarantee
  // that matters is that a dev build can never hold this repo's Latest pointer.
  it('keeps both dev channels in the fork repo and off the Latest pointer', () => {
    withHourlyEnv((hourly) => {
      withAdhocEnv((adhoc) => {
        expect(hourly.publish.repo).toBe('orca-oss')
        expect(adhoc.publish.repo).toBe('orca-oss')
        expect(hourly.publish.releaseType).toBe('prerelease')
        expect(adhoc.publish.releaseType).toBe('prerelease')
      })
    })
  })
})
