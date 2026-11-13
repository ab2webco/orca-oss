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
    return {
      file: env.ORCA_POWERSHELL_BIN || 'powershell',
      args: [
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy',
        'Bypass',
        '-Command',
        [
          "$ErrorActionPreference = 'Stop'",
          `Expand-Archive -LiteralPath ${quotePowerShellLiteral(zipPath)} -DestinationPath ${quotePowerShellLiteral(extractDir)} -Force`
        ].join('; ')
      ],
      label: 'powershell Expand-Archive'
    }
  }

  return {
    file: env.ORCA_UNZIP_BIN || 'unzip',
    args: ['-q', zipPath, '-d', extractDir],
    label: 'unzip'
  }
}

function quotePowerShellLiteral(value) {
  return `'${String(value).replaceAll("'", "''")}'`
}
