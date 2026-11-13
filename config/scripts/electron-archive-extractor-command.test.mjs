import { describe, expect, it } from 'vitest'
import { getElectronArchiveExtractorCommand } from './electron-archive-extractor-command.mjs'

const ZIP_PATH = 'C:\\Users\\runner\\AppData\\Local\\Temp\\orca-electron-1\\electron.zip'
const EXTRACT_DIR = 'C:\\Users\\runner\\AppData\\Local\\Temp\\orca-electron-1\\extract'

describe('getElectronArchiveExtractorCommand', () => {
  it('extracts with the built-in tar.exe on Windows, not PowerShell Expand-Archive', () => {
    expect(
      getElectronArchiveExtractorCommand(ZIP_PATH, EXTRACT_DIR, { platform: 'win32', env: {} })
    ).toEqual({
      file: 'tar.exe',
      args: ['-xf', ZIP_PATH, '-C', EXTRACT_DIR],
      label: 'tar.exe -xf'
    })
  })

  it.each(['darwin', 'linux'])('keeps unzip on %s', (platform) => {
    expect(
      getElectronArchiveExtractorCommand('/tmp/electron.zip', '/tmp/extract', { platform, env: {} })
    ).toEqual({
      file: 'unzip',
      args: ['-q', '/tmp/electron.zip', '-d', '/tmp/extract'],
      label: 'unzip'
    })
  })

  it('lets the extractor override win on every platform', () => {
    const env = { ORCA_ELECTRON_PACKAGE_EXTRACTOR: '/repo/fake-extractor.cjs' }
    expect(
      getElectronArchiveExtractorCommand(ZIP_PATH, EXTRACT_DIR, { platform: 'win32', env })
    ).toEqual({
      file: process.execPath,
      args: ['/repo/fake-extractor.cjs', ZIP_PATH, EXTRACT_DIR],
      label: 'node /repo/fake-extractor.cjs'
    })
  })
})
