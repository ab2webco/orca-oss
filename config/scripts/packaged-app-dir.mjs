// Resolves the default packaged-app directory produced by electron-builder for the host platform.
import { readdirSync } from 'node:fs'
import { join } from 'node:path'

const MAC_DIST_DIR = 'dist/mac-arm64'

// Why discovered instead of hardcoded: the macOS bundle dir is named after productName,
// so a product rename must not require editing every smoke script.
export function resolveDefaultAppDir(platform = process.platform) {
  if (platform === 'darwin') {
    return join(MAC_DIST_DIR, findSingleAppBundleName(MAC_DIST_DIR))
  }
  if (platform === 'win32') {
    return 'dist/win-unpacked'
  }
  return 'dist/linux-unpacked'
}

function findSingleAppBundleName(distDir) {
  let entries
  try {
    entries = readdirSync(distDir, { withFileTypes: true })
  } catch (error) {
    throw new Error(`Cannot read ${distDir} to locate the packaged .app bundle: ${error.message}`)
  }
  const bundles = entries
    .filter((entry) => entry.isDirectory() && entry.name.endsWith('.app'))
    .map((entry) => entry.name)
  if (bundles.length !== 1) {
    throw new Error(
      `Expected exactly one .app bundle in ${distDir}, found ${bundles.length}${
        bundles.length > 0 ? `: ${bundles.join(', ')}` : ''
      }`
    )
  }
  return bundles[0]
}
