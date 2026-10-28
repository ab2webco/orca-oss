import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'

const scriptPath = fileURLToPath(
  new URL('../../scripts/prepare-android-release.mjs', import.meta.url)
)

const appConfig = {
  expo: {
    version: '0.0.22',
    android: {
      versionCode: 4
    }
  }
}

let tempDirs: string[] = []

function createAppConfig() {
  const dir = mkdtempSync(join(tmpdir(), 'orca-android-release-'))
  tempDirs.push(dir)
  const configPath = join(dir, 'app.json')
  const contents = `${JSON.stringify(appConfig, null, 2)}\n`
  writeFileSync(configPath, contents)
  return { configPath, contents }
}

describe('prepare Android release script', () => {
  afterEach(() => {
    for (const dir of tempDirs) {
      rmSync(dir, { force: true, recursive: true })
    }
    tempDirs = []
  })

  it('uses committed Android release identity without mutating app config', () => {
    const { configPath, contents } = createAppConfig()

    const output = execFileSync(process.execPath, [scriptPath], {
      encoding: 'utf8',
      env: {
        ...process.env,
        MOBILE_APP_CONFIG_PATH: configPath,
        MOBILE_ANDROID_PUBLISH_RELEASE: 'true'
      }
    })

    expect(output).toContain('Prepared Orca Lab Mobile Android 0.0.22 (4)')
    expect(output).toContain('Release tag: mobile-android-v0.0.22')
    expect(readFileSync(configPath, 'utf8')).toBe(contents)
  })

  it('rejects release-only Android versionCode bumps', () => {
    const { configPath } = createAppConfig()

    const result = spawnSync(process.execPath, [scriptPath], {
      encoding: 'utf8',
      env: {
        ...process.env,
        MOBILE_APP_CONFIG_PATH: configPath,
        MOBILE_ANDROID_BUMP_VERSION_CODE: 'true'
      }
    })

    expect(result.status).toBe(1)
    expect(result.stderr).toContain(
      'Android versionCode changes must be committed in mobile/app.json before release'
    )
  })

  it('rejects release versions that do not match committed app config', () => {
    const { configPath } = createAppConfig()

    const result = spawnSync(process.execPath, [scriptPath], {
      encoding: 'utf8',
      env: {
        ...process.env,
        MOBILE_APP_CONFIG_PATH: configPath,
        MOBILE_ANDROID_RELEASE_VERSION: '0.0.23'
      }
    })

    expect(result.status).toBe(1)
    expect(result.stderr).toContain(
      'MOBILE_ANDROID_RELEASE_VERSION must match the committed mobile app version'
    )
  })

  it('fails before the build when Play already holds the committed versionCode', () => {
    const { configPath } = createAppConfig()

    const result = spawnSync(process.execPath, [scriptPath], {
      encoding: 'utf8',
      env: {
        ...process.env,
        MOBILE_APP_CONFIG_PATH: configPath,
        MOBILE_ANDROID_PLAY_HIGHEST_VERSION_CODE: '4'
      }
    })

    expect(result.status).toBe(1)
    expect(result.stderr).toContain(
      'Android versionCode 4 is not above 4, the highest one Play already has'
    )
  })

  it('accepts a committed versionCode above the highest one Play has', () => {
    const { configPath } = createAppConfig()

    const output = execFileSync(process.execPath, [scriptPath], {
      encoding: 'utf8',
      env: {
        ...process.env,
        MOBILE_APP_CONFIG_PATH: configPath,
        MOBILE_ANDROID_PLAY_HIGHEST_VERSION_CODE: '3'
      }
    })

    expect(output).toContain('Highest Play versionCode: 3')
  })

  it('rejects a malformed Play versionCode instead of skipping the check', () => {
    const { configPath } = createAppConfig()

    const result = spawnSync(process.execPath, [scriptPath], {
      encoding: 'utf8',
      env: {
        ...process.env,
        MOBILE_APP_CONFIG_PATH: configPath,
        MOBILE_ANDROID_PLAY_HIGHEST_VERSION_CODE: 'none'
      }
    })

    expect(result.status).toBe(1)
    expect(result.stderr).toContain(
      'MOBILE_ANDROID_PLAY_HIGHEST_VERSION_CODE must be a non-negative integer'
    )
  })
})
