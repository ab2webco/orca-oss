import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  APP_EXE_NAME,
  INSTALL_DIR_NAME,
  UNINSTALLER_EXE_NAME
} from './windows-install-names.mjs'

/** Why a text read: the builder config is CJS and pulls in build-time-only modules. */
function builderConfigSource() {
  return readFileSync('config/electron-builder.config.cjs', 'utf-8')
}

describe('windows-install-names', () => {
  it('tracks win.executableName', () => {
    const executableName = builderConfigSource().match(
      /win: \{\s*\n\s*executableName: '([^']+)'/
    )?.[1]

    expect(executableName).toBeDefined()
    expect(APP_EXE_NAME).toBe(`${executableName}.exe`)
  })

  it('tracks productName, which NSIS uses for the uninstaller', () => {
    const productName = builderConfigSource().match(/^ {2}productName: '([^']+)',$/m)?.[1]

    expect(productName).toBeDefined()
    expect(UNINSTALLER_EXE_NAME).toBe(`Uninstall ${productName}.exe`)
  })

  it('tracks the package name, not the product name, for the install directory', () => {
    const packageName = JSON.parse(readFileSync('package.json', 'utf-8')).name

    // The safety guard that refuses to uninstall a developer's real install
    // compares against this; renaming it with the product would disarm the guard.
    expect(INSTALL_DIR_NAME.toLowerCase()).toBe(packageName.toLowerCase())
  })
})
