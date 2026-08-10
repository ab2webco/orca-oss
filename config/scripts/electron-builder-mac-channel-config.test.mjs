import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const electronBuilderConfig = require('../electron-builder.config.cjs')

const MUTABLE_BUILD_ENV = [
  'ORCA_MAC_HOURLY',
  'ORCA_MAC_DAILY',
  'ORCA_MAC_ADHOC',
  'ORCA_MAC_RELEASE',
  'ORCA_HOURLY_BUILD_VERSION',
  'ORCA_DAILY_BUILD_VERSION',
  'ORCA_ADHOC_BUILD_VERSION',
  'ORCA_LOCAL_BUILD_VERSION'
]

/** Re-requires the config under a temporary env, then restores env and module cache. */
function withEnv(env, assert) {
  const configPath = require.resolve('../electron-builder.config.cjs')
  const original = Object.fromEntries(MUTABLE_BUILD_ENV.map((key) => [key, process.env[key]]))
  try {
    for (const key of MUTABLE_BUILD_ENV) {
      delete process.env[key]
    }
    Object.assign(process.env, env)
    delete require.cache[configPath]
    assert(require('../electron-builder.config.cjs'))
  } finally {
    for (const [key, value] of Object.entries(original)) {
      if (value === undefined) {
        delete process.env[key]
      } else {
        process.env[key] = value
      }
    }
    delete require.cache[configPath]
    require('../electron-builder.config.cjs')
  }
}

const withHourlyEnv = (assert) => withEnv({ ORCA_MAC_HOURLY: '1' }, assert)
const withDailyEnv = (assert) => withEnv({ ORCA_MAC_DAILY: '1' }, assert)
const withAdhocEnv = (assert) => withEnv({ ORCA_MAC_ADHOC: '1' }, assert)

describe('electron-builder mac channel config', () => {
  // Why: Squirrel.Mac swaps the .app in place only when the replacement carries the
  // same bundle id and a valid Developer ID signature. A hourly built on the local
  // (com.stablyai.orca.local, ad-hoc) identity would be un-installable over a real
  // Orca — the whole point of the channel.
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

  // Why upstream splits the dev channels into their own repos: the main repo's
  // releases atom feed exposes only its 10 newest entries, and 24 hourly tags a
  // day there would evict every stable/RC entry. The fork publishes no dev tags
  // at all — every dev workflow is gated `github.repository == 'stablyai/orca'` —
  // so one repo costs it nothing, and pointing a channel at upstream's repo would
  // publish lab artifacts outside the fork. What the fork does keep is the
  // prerelease downgrade, which is what stops a dev build taking Latest.
  it('publishes hourly builds to the fork repo, born a prerelease', () => {
    withHourlyEnv((config) => {
      expect(config.publish).toMatchObject({ repo: 'orca-oss', releaseType: 'prerelease' })
    })
    expect(electronBuilderConfig.publish).toMatchObject({
      repo: 'orca-oss',
      releaseType: 'release'
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
  // argument apply. Only the destination repo differs.
  it('builds adhoc artifacts with the release identity, published to the fork', () => {
    withAdhocEnv((config) => {
      expect(config.appId).toBe('com.stablyai.orca')
      expect(config.mac.hardenedRuntime).toBe(true)
      expect(config.mac.notarize).toBe(true)
      expect(config.forceCodeSigning).toBe(true)
      expect(config.publish).toMatchObject({ repo: 'orca-oss', releaseType: 'prerelease' })
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

  it('builds daily artifacts with the release identity, published to the fork', () => {
    withDailyEnv((config) => {
      expect(config.appId).toBe('com.stablyai.orca')
      expect(config.mac.hardenedRuntime).toBe(true)
      expect(config.mac.notarize).toBe(true)
      expect(config.forceCodeSigning).toBe(true)
      expect(config.publish).toMatchObject({ repo: 'orca-oss', releaseType: 'prerelease' })
    })
  })

  it('stamps daily packages with the daily version', () => {
    withEnv(
      { ORCA_MAC_DAILY: '1', ORCA_DAILY_BUILD_VERSION: '1.4.160-daily.202607281300' },
      (config) => {
        expect(config.extraMetadata).toEqual({ version: '1.4.160-daily.202607281300' })
      }
    )
  })

  // Why inverted rather than dropped: upstream keeps the dev channels on separate
  // repos so a branch or daily build never reaches someone riding main's hourlies.
  // The fork publishes no dev tags, so the invariant it must hold instead is the
  // one that protects its own users — every channel resolves inside the fork and
  // none of them is born a full release. If the fork ever ungates a dev workflow,
  // restore upstream's split before it publishes anything.
  it('keeps every dev channel inside the fork, none of them a release', () => {
    withHourlyEnv((hourly) => {
      withDailyEnv((daily) => {
        withAdhocEnv((adhoc) => {
          for (const config of [hourly, daily, adhoc]) {
            expect(config.publish).toMatchObject({
              owner: 'ab2webco',
              repo: 'orca-oss',
              releaseType: 'prerelease'
            })
          }
        })
      })
    })
  })
})
