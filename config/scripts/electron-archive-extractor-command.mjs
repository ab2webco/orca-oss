import { platform as osPlatform } from 'node:os'

export function getElectronArchiveExtractorCommand(
  zipPath,
  extractDir,
  { platform = osPlatform(), env = process.env } = {}
) {
  if (env.ORCA_ELECTRON_PACKAGE_EXTRACTOR) {
    return {
      file: process.execPath,
      args: [env.ORCA_ELECTRON_PACKAGE_EXTRACTOR, zipPath, extractDir],
      label: `node ${env.ORCA_ELECTRON_PACKAGE_EXTRACTOR}`
    }
  }

  if (platform === 'win32') {
    // Why: Windows PowerShell's Expand-Archive broke on the windows-2022 20261112.366 image (ORCA-1191); bsdtar ships with Windows 10 1803+.
    return {
      file: 'tar.exe',
      args: ['-xf', zipPath, '-C', extractDir],
      label: 'tar.exe -xf'
    }
  }

  return {
    file: env.ORCA_UNZIP_BIN || 'unzip',
    args: ['-q', zipPath, '-d', extractDir],
    label: 'unzip'
  }
}
