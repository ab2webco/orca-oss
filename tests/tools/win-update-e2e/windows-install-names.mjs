// The Windows names electron-builder derives, kept in one place because they come
// from three different sources and only two of them move when the product is renamed.
//
//   app exe      <- win.executableName        (config/electron-builder.config.cjs)
//   uninstaller  <- NSIS uninstallDisplayName <- productName
//   install dir  <- NSIS sanitizedName        <- package.json "name"  (NOT productName)
//
// Comparisons against the install dir are case-insensitive: the observed casing on a
// dev box is lowercase "orca".

export const APP_EXE_NAME = 'Orca Lab.exe'

export const UNINSTALLER_EXE_NAME = 'Uninstall Orca Lab.exe'

export const INSTALL_DIR_NAME = 'orca'
