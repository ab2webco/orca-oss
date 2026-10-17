// The catalogs Orca Lab ships next to en.json. Mirrors SUPPORTED_UI_LOCALES in
// src/shared/ui-locale.ts, which plain Node cannot import (ORCA-596).
export const SHIPPED_TARGET_LOCALES = ['es']

export function isShippedCatalogFile(fileName) {
  return SHIPPED_TARGET_LOCALES.includes(fileName.replace(/\.json$/, ''))
}
