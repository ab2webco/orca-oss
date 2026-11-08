import { BrowserWindow, nativeTheme } from 'electron'

/** Orca's resolved light or dark look for the game state; none from a headless serve, which has no window. */
export function orcaGameAppearanceOf(): 'dark' | 'light' | undefined {
  try {
    if (BrowserWindow.getAllWindows().length === 0) {
      return undefined
    }
    return nativeTheme.shouldUseDarkColors ? 'dark' : 'light'
  } catch {
    // Why: a process that loads Electron without its window API has no look to report either.
    return undefined
  }
}
