import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  addAndroidUploadSigningConfig,
  UPLOAD_SIGNING_PROPERTIES
} from '../plugins/android-upload-signing-gradle'

const PLUGIN_PATH = './plugins/android-upload-signing.js'

function read(relativePath: string): string {
  return readFileSync(fileURLToPath(new URL(`../${relativePath}`, import.meta.url)), 'utf8')
}

// Captured from `npx expo prebuild --platform android --no-install` on Expo 55;
// a hand-written fixture would not prove the anchors exist in what Expo emits.
const stockBuildGradle = read('plugins/expo-generated-app-build.gradle')

const appConfig = JSON.parse(read('app.json')) as {
  expo: { plugins: (string | unknown[])[] }
}

// Independent of the transform's own brace scanner, so a bug there cannot make
// these assertions read the wrong region.
function sliceBlock(contents: string, header: string, fromIndex = 0): string {
  const bodyStart = contents.indexOf('{', contents.indexOf(header, fromIndex))
  let depth = 0
  for (let index = bodyStart; index < contents.length; index += 1) {
    if (contents[index] === '{') {
      depth += 1
    } else if (contents[index] === '}') {
      depth -= 1
      if (depth === 0) {
        return contents.slice(bodyStart + 1, index)
      }
    }
  }
  throw new Error(`unbalanced braces after ${header}`)
}

function releaseBuildType(contents: string): string {
  return sliceBlock(sliceBlock(contents, 'buildTypes {'), 'release {')
}

// Why pinned: a debug-signed .aab still builds and still installs, so nothing
// short of asserting the signing wiring catches its loss.
describe('android upload signing config plugin', () => {
  it('is registered in app.json, so prebuild applies it', () => {
    const registered = appConfig.expo.plugins.map((plugin) =>
      Array.isArray(plugin) ? plugin[0] : plugin
    )

    expect(registered).toContain(PLUGIN_PATH)
  })

  it('starts from a build.gradle whose release build type uses the debug keystore', () => {
    expect(releaseBuildType(stockBuildGradle)).toContain('signingConfig signingConfigs.debug')
    expect(stockBuildGradle).not.toContain('signingConfigs.release')
  })

  it('adds a release signing config that reads the four Gradle properties', () => {
    const signingConfigs = sliceBlock(
      addAndroidUploadSigningConfig(stockBuildGradle),
      'signingConfigs {'
    )

    expect(signingConfigs).toContain('release {')
    for (const property of Object.values(UPLOAD_SIGNING_PROPERTIES)) {
      expect(signingConfigs, property).toContain(`findProperty('${property}')`)
    }
  })

  it('repoints the release build type off the debug keystore', () => {
    const release = releaseBuildType(addAndroidUploadSigningConfig(stockBuildGradle))

    expect(release).toContain('signingConfig signingConfigs.release')
    expect(release).not.toContain('signingConfigs.debug')
  })

  it('leaves the debug build type signed with the debug keystore', () => {
    const transformed = addAndroidUploadSigningConfig(stockBuildGradle)
    const debug = sliceBlock(sliceBlock(transformed, 'buildTypes {'), 'debug {')

    expect(debug).toContain('signingConfig signingConfigs.debug')
  })

  it('falls back to the debug keystore when no upload key is configured', () => {
    const release = sliceBlock(
      sliceBlock(addAndroidUploadSigningConfig(stockBuildGradle), 'signingConfigs {'),
      'release {'
    )

    expect(release).toContain("storeFile file('debug.keystore')")
  })

  it('is a no-op when already applied', () => {
    const once = addAndroidUploadSigningConfig(stockBuildGradle)

    expect(addAndroidUploadSigningConfig(once)).toBe(once)
  })

  // Why throwing matters: a no-op on a changed template would silently restore
  // the debug-signed release the plugin exists to prevent.
  it('throws instead of no-oping when the Expo template no longer matches', () => {
    expect(() => addAndroidUploadSigningConfig('android {\n}\n')).toThrow(/signingConfigs/)
    expect(() =>
      addAndroidUploadSigningConfig(
        'android {\n    signingConfigs {\n        debug {\n        }\n    }\n' +
          '    buildTypes {\n        release {\n            minifyEnabled false\n        }\n    }\n}\n'
      )
    ).toThrow(/buildTypes\.release/)
  })
})
