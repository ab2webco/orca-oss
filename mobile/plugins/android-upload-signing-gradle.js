// Pure text transform, kept apart from the config plugin so the unit test can
// pin its output without loading expo/config-plugins.

/** Gradle project properties the release signing config reads. */
const UPLOAD_SIGNING_PROPERTIES = {
  storeFile: 'ORCA_UPLOAD_STORE_FILE',
  storePassword: 'ORCA_UPLOAD_STORE_PASSWORD',
  keyAlias: 'ORCA_UPLOAD_KEY_ALIAS',
  keyPassword: 'ORCA_UPLOAD_KEY_PASSWORD'
}

const RELEASE_SIGNING_CONFIG = `        release {
            def uploadStoreFile = (project.findProperty('${UPLOAD_SIGNING_PROPERTIES.storeFile}') ?: '').toString()
            if (uploadStoreFile.isEmpty()) {
                // No upload key configured: the debug keystore keeps sideload builds
                // working. The release workflow fails on this signer once a key exists.
                storeFile file('debug.keystore')
                storePassword 'android'
                keyAlias 'androiddebugkey'
                keyPassword 'android'
            } else {
                storeFile file(uploadStoreFile)
                storePassword((project.findProperty('${UPLOAD_SIGNING_PROPERTIES.storePassword}') ?: '').toString())
                keyAlias((project.findProperty('${UPLOAD_SIGNING_PROPERTIES.keyAlias}') ?: '').toString())
                keyPassword((project.findProperty('${UPLOAD_SIGNING_PROPERTIES.keyPassword}') ?: '').toString())
            }
        }
`

const DEBUG_SIGNING_CONFIG_REFERENCE = 'signingConfig signingConfigs.debug'
const RELEASE_SIGNING_CONFIG_REFERENCE = 'signingConfig signingConfigs.release'

// Expo's template tells the reader to generate their own keystore; once the
// release config does that, the note is stale. Optional so a reworded template
// still transforms.
const STALE_KEYSTORE_NOTICE =
  /[ \t]*\/\/ Caution! In production[^\n]*\n[ \t]*\/\/ see https:\/\/reactnative\.dev\/docs\/signed-apk-android\.\n/

/**
 * @typedef {{ bodyStart: number, bodyEnd: number }} GradleBlock
 */

/**
 * Locates a brace-delimited block by its opening header, scanning braces so the
 * result survives Expo reordering what is inside it.
 *
 * @param {string} contents
 * @param {string} header e.g. `signingConfigs {`
 * @param {number} fromIndex
 * @param {number} toIndex
 * @returns {GradleBlock | null}
 */
function findGradleBlock(contents, header, fromIndex = 0, toIndex = contents.length) {
  const headerStart = contents.indexOf(header, fromIndex)
  if (headerStart === -1 || headerStart >= toIndex) {
    return null
  }

  const bodyStart = contents.indexOf('{', headerStart)
  let depth = 0
  for (let index = bodyStart; index < contents.length; index += 1) {
    const character = contents[index]
    if (character === '{') {
      depth += 1
    } else if (character === '}') {
      depth -= 1
      if (depth === 0) {
        return { bodyStart: bodyStart + 1, bodyEnd: index }
      }
    }
  }

  return null
}

/**
 * Adds a `release` signing config fed by Gradle properties and repoints
 * `buildTypes.release` at it, replacing Expo's default of the debug keystore.
 *
 * Throws rather than no-ops on an unrecognized template: a silent skip is how a
 * debug-signed bundle reaches a release.
 *
 * @param {string} contents contents of the generated `android/app/build.gradle`
 * @returns {string}
 */
function addAndroidUploadSigningConfig(contents) {
  if (contents.includes(RELEASE_SIGNING_CONFIG_REFERENCE)) {
    return contents
  }

  const signingConfigs = findGradleBlock(contents, 'signingConfigs {')
  if (!signingConfigs) {
    throw new Error('android/app/build.gradle has no signingConfigs block to extend')
  }

  const buildTypes = findGradleBlock(contents, 'buildTypes {')
  if (!buildTypes) {
    throw new Error('android/app/build.gradle has no buildTypes block')
  }

  const releaseBuildType = findGradleBlock(
    contents,
    'release {',
    buildTypes.bodyStart,
    buildTypes.bodyEnd
  )
  if (!releaseBuildType) {
    throw new Error('android/app/build.gradle has no buildTypes.release block')
  }

  const releaseBody = contents.slice(releaseBuildType.bodyStart, releaseBuildType.bodyEnd)
  if (!releaseBody.includes(DEBUG_SIGNING_CONFIG_REFERENCE)) {
    throw new Error(
      `buildTypes.release does not declare "${DEBUG_SIGNING_CONFIG_REFERENCE}"; the Expo template changed`
    )
  }

  // Rewrite buildTypes first: it sits after signingConfigs, so the insertion
  // offset below stays valid.
  const withReleaseBuildType =
    contents.slice(0, releaseBuildType.bodyStart) +
    releaseBody
      .replace(STALE_KEYSTORE_NOTICE, '')
      .replace(DEBUG_SIGNING_CONFIG_REFERENCE, RELEASE_SIGNING_CONFIG_REFERENCE) +
    contents.slice(releaseBuildType.bodyEnd)

  // Insert on the closing brace's own line so its indentation is not split.
  const insertAt = withReleaseBuildType.lastIndexOf('\n', signingConfigs.bodyEnd) + 1

  return (
    withReleaseBuildType.slice(0, insertAt) +
    RELEASE_SIGNING_CONFIG +
    withReleaseBuildType.slice(insertAt)
  )
}

module.exports = {
  UPLOAD_SIGNING_PROPERTIES,
  addAndroidUploadSigningConfig
}
