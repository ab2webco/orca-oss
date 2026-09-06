import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { name: 'Orca' } }))

import { APP_DISPLAY_NAME } from '../../shared/app-identity'
import { createMacAppMenu } from './mac-app-menu'

function submenuOf(menu: Electron.MenuItemConstructorOptions) {
  return (menu.submenu ?? []) as Electron.MenuItemConstructorOptions[]
}

function labelForRole(menu: Electron.MenuItemConstructorOptions, role: string) {
  return submenuOf(menu).find((item) => item.role === role)?.label
}

const items = {
  checkForUpdatesItem: { label: 'Check for Updates...' },
  settingsItem: { label: 'Settings' }
}

// Why not the registerAppMenu suite: that one is platform-gated, and CI runs no
// macOS runner — the assertions below would never execute there.
describe('createMacAppMenu', () => {
  it('names the roles after the product, since app.setName pins the Keychain name', () => {
    const menu = createMacAppMenu({ title: APP_DISPLAY_NAME, ...items })

    expect(labelForRole(menu, 'about')).toBe(`About ${APP_DISPLAY_NAME}`)
    expect(labelForRole(menu, 'hide')).toBe(`Hide ${APP_DISPLAY_NAME}`)
    expect(labelForRole(menu, 'quit')).toBe(`Quit ${APP_DISPLAY_NAME}`)
  })

  it('keeps the per-branch dev title out of the role labels', () => {
    const menu = createMacAppMenu({ title: `${APP_DISPLAY_NAME}: feature/billing`, ...items })

    expect(menu.label).toBe(`${APP_DISPLAY_NAME}: feature/billing`)
    // "Quit Orca Lab: feature/billing" would be wrong — roles name the product.
    expect(labelForRole(menu, 'quit')).toBe(`Quit ${APP_DISPLAY_NAME}`)
  })

  it('leaves roles whose macOS label carries no app name to Electron', () => {
    const menu = createMacAppMenu({ title: APP_DISPLAY_NAME, ...items })

    for (const role of ['services', 'hideOthers', 'unhide']) {
      expect(labelForRole(menu, role)).toBeUndefined()
    }
  })
})
