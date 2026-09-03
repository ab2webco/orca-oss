const { withAppBuildGradle } = require('expo/config-plugins')
const { addAndroidUploadSigningConfig } = require('./android-upload-signing-gradle')

// Why a plugin and not a committed build.gradle edit: `expo prebuild`
// regenerates android/ on every run, and Expo's template signs release builds
// with the debug keystore, which Play rejects on upload.
module.exports = function withAndroidUploadSigning(config) {
  return withAppBuildGradle(config, (cfg) => {
    if (cfg.modResults.language !== 'groovy') {
      throw new Error(
        `android/app/build.gradle is ${cfg.modResults.language}; the upload signing transform expects groovy`
      )
    }

    cfg.modResults.contents = addAndroidUploadSigningConfig(cfg.modResults.contents)
    return cfg
  })
}
