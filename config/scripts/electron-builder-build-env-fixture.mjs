// Test-only build-env harness shared by the electron-builder suites: re-requiring the
// config under a temporary env is the only way to observe its channel-dependent shape.
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)

export const MUTABLE_BUILD_ENV = [
  'ORCA_MAC_HOURLY',
  'ORCA_MAC_ADHOC',
  'ORCA_MAC_RELEASE',
  'ORCA_HOURLY_BUILD_VERSION',
  'ORCA_ADHOC_BUILD_VERSION',
  'ORCA_LOCAL_BUILD_VERSION',
  // Why: listed so withEnv clears and restores it too — otherwise a set value
  // leaks into every later case and silently turns releases into prereleases.
  'ORCA_LAB_RELEASE_CANDIDATE'
]

/** Re-requires the config under a temporary env, then restores env and module cache. */
export function withEnv(env, assert) {
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

export const withHourlyEnv = (assert) => withEnv({ ORCA_MAC_HOURLY: '1' }, assert)
export const withAdhocEnv = (assert) => withEnv({ ORCA_MAC_ADHOC: '1' }, assert)
