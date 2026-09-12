import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { NtExecutable, NtExecutableResource, Resource } from 'resedit'
import { describe, expect, it } from 'vitest'
import { AppInfo } from 'app-builder-lib/out/appInfo.js'
import { editWindowsResources } from 'app-builder-lib/out/util/resEdit.js'
import builderConfig from '../electron-builder.config.cjs'
import { createMinimalWindowsExecutable } from './__fixtures__/minimal-windows-pe.mjs'
import { writeWindowsExecutableVersionInfo } from './windows-executable-version-info.cjs'

const packageMetadata = JSON.parse(readFileSync(resolve('package.json'), 'utf8'))
const iconPath = resolve('resources/build/icon.ico')

function packAppExecutable() {
  const appOutDir = mkdtempSync(join(tmpdir(), 'orca-win-version-info-'))
  const appInfo = new AppInfo(
    { metadata: packageMetadata, config: builderConfig, devMetadata: null },
    null,
    builderConfig.win
  )
  const file = join(appOutDir, `${appInfo.productFilename}.exe`)
  writeFileSync(file, createMinimalWindowsExecutable())
  const context = {
    appOutDir,
    electronPlatformName: 'win32',
    packager: {
      appInfo,
      platformSpecificBuildOptions: builderConfig.win,
      getIconPath: async () => iconPath
    }
  }
  return { context, file, appInfo }
}

/** The exact strings electron-builder writes from productName (winPackager.js:139). */
async function applyBuilderVersionInfo(file, appInfo) {
  await editWindowsResources({
    file,
    versionStrings: {
      FileDescription: appInfo.productName,
      ProductName: appInfo.productName,
      LegalCopyright: appInfo.copyright,
      InternalName: appInfo.productFilename,
      OriginalFilename: ''
    },
    fileVersion: appInfo.buildVersion,
    productVersion: appInfo.getVersionInWeirdWindowsForm(),
    iconPath
  })
}

function readVersionResource(file) {
  const executable = NtExecutable.from(readFileSync(file))
  const resources = NtExecutableResource.from(executable)
  const versionInfo = Resource.VersionInfo.fromEntries(resources.entries)[0]
  const language = versionInfo.getAllLanguagesForStringValues()[0]
  return {
    strings: versionInfo.getStringValues(language),
    iconGroupCount: resources.entries.filter((entry) => entry.type === 14).length
  }
}

describe('version resource of the packaged Windows executable', () => {
  it('renames what Task Manager reads, over electron-builder’s own pass', async () => {
    // The ticket's exact symptom: the process shows up as "Orca". FileDescription is
    // the string Task Manager puts in its Name column. ORCA-491.
    const { context, file, appInfo } = packAppExecutable()
    await applyBuilderVersionInfo(file, appInfo)
    expect(readVersionResource(file).strings.FileDescription).toBe('Orca')

    await writeWindowsExecutableVersionInfo(context)

    const { strings } = readVersionResource(file)
    expect(strings.FileDescription).toBe('Orca Lab')
    expect(strings.ProductName).toBe('Orca Lab')
  })

  it('keeps the icon and the version strings electron-builder no longer writes', async () => {
    // Taking the edit over means owning all of it: with signAndEditExecutable off,
    // anything dropped here is dropped from the shipped exe.
    const { context, file, appInfo } = packAppExecutable()
    await writeWindowsExecutableVersionInfo(context)

    const { strings, iconGroupCount } = readVersionResource(file)
    expect(iconGroupCount).toBe(1)
    expect(strings.FileVersion).toBe(appInfo.buildVersion)
    expect(strings.InternalName).toBe('Orca Lab')
    expect(strings.LegalCopyright).toBe(appInfo.copyright)
  })

  it('fails the build when no icon resolves instead of shipping the Electron default', async () => {
    const { context } = packAppExecutable()
    context.packager.getIconPath = async () => null
    await expect(writeWindowsExecutableVersionInfo(context)).rejects.toThrow(/icon/)
  })

  it('leaves electron-builder no second pass to clobber the display name', () => {
    // Its edit runs after afterPack, so the hook only holds while this stays false.
    expect(builderConfig.win.signAndEditExecutable).toBe(false)
  })
})
