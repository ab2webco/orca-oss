const { existsSync } = require('node:fs')
const { join } = require('node:path')
const { editWindowsResources } = require('app-builder-lib/out/util/resEdit')

// Why: Task Manager, the Details tab and the taskbar tooltip all read the exe's
// FileDescription, and electron-builder writes it from productName with no override
// (winPackager.js:139). productName has to stay 'Orca' — it is the bundle identity
// macOS resolves helpers from, and moving it shipped a build that did not launch
// (ORCA-448). So Windows gets the display name from here instead.
const WINDOWS_EXECUTABLE_DISPLAY_NAME = 'Orca Lab'

/**
 * Write the app exe's version resource, replacing electron-builder's own pass
 * (disabled via `win.signAndEditExecutable: false`, because it runs *after* this
 * hook — platformPackager.js:245 emits afterPack, :255 signs and re-edits — and
 * would overwrite the display name). Everything except the two display strings
 * reproduces what winPackager.js:139 writes, so the icon and version resource are
 * unchanged. Runs before any signature exists: SignPath signs a later CI job.
 *
 * @param {import('electron-builder').AfterPackContext} context
 */
async function writeWindowsExecutableVersionInfo(context) {
  const { packager } = context
  const { appInfo } = packager
  const file = join(context.appOutDir, `${appInfo.productFilename}.exe`)
  if (!existsSync(file)) {
    throw new Error(`Missing packaged Windows executable: ${file}`)
  }
  const iconPath = await packager.getIconPath()
  if (iconPath == null) {
    // Why fail closed: electron-builder's edit is off, so a missing icon here is
    // not a warning — it ships the default Electron icon to every Windows user.
    throw new Error(`No Windows icon resolved for ${file}; refusing to ship the Electron default`)
  }
  const versionStrings = {
    FileDescription: WINDOWS_EXECUTABLE_DISPLAY_NAME,
    ProductName: WINDOWS_EXECUTABLE_DISPLAY_NAME,
    LegalCopyright: appInfo.copyright,
    InternalName: appInfo.productFilename,
    OriginalFilename: ''
  }
  if (appInfo.companyName != null) {
    versionStrings.CompanyName = appInfo.companyName
  }
  if (packager.platformSpecificBuildOptions.legalTrademarks != null) {
    versionStrings.LegalTrademarks = packager.platformSpecificBuildOptions.legalTrademarks
  }
  await editWindowsResources({
    file,
    versionStrings,
    fileVersion: appInfo.shortVersion || appInfo.buildVersion,
    productVersion: appInfo.shortVersionWindows || appInfo.getVersionInWeirdWindowsForm(),
    requestedExecutionLevel: packager.platformSpecificBuildOptions.requestedExecutionLevel,
    iconPath
  })
}

module.exports = { WINDOWS_EXECUTABLE_DISPLAY_NAME, writeWindowsExecutableVersionInfo }
