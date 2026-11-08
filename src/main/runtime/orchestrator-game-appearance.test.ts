import { beforeEach, describe, expect, it, vi } from 'vitest'

const electron = vi.hoisted(() => ({ windows: [{}], isDark: true }))

vi.mock('electron', () => ({
  BrowserWindow: { getAllWindows: () => electron.windows },
  nativeTheme: {
    get shouldUseDarkColors() {
      return electron.isDark
    }
  }
}))

import { orcaGameAppearanceOf } from './orchestrator-game-appearance'

describe("Orca's look in the game state", () => {
  beforeEach(() => {
    electron.windows = [{}]
  })

  it('follows the resolved theme while a window is open', () => {
    electron.isDark = true
    expect(orcaGameAppearanceOf()).toBe('dark')
    electron.isDark = false
    expect(orcaGameAppearanceOf()).toBe('light')
  })

  it('reports none from a headless serve, which has no window', () => {
    electron.windows = []
    expect(orcaGameAppearanceOf()).toBeUndefined()
  })
})
