import { app } from 'electron'
import { APP_DISPLAY_NAME } from '../../shared/app-identity'
import { translateMain } from '../i18n/main-i18n'

type MacAppMenuOptions = {
  /** Menu title. In dev this carries the branch, e.g. `Orca Lab: my-branch`. */
  title?: string
  checkForUpdatesItem: Electron.MenuItemConstructorOptions
  settingsItem: Electron.MenuItemConstructorOptions
}

/**
 * The macOS app menu, mandatory on darwin: it owns the hide/hideOthers/unhide/
 * services/quit roles that only make sense in the system menu bar. Windows and
 * Linux omit it and distribute its items across File / Help instead.
 *
 * Why the explicit labels: Electron derives role labels from `app.getName()`,
 * which `app.setName()` pins to the Keychain-driving name — so the roles would
 * read "About Orca" under a menu titled "Orca Lab". `productName` cannot fix
 * this; an explicit `app.setName()` wins over the packaged name.
 *
 * Why only these three: services/hideOthers/unhide render as "Services", "Hide
 * Others" and "Show All" — they carry no app name, so Electron's own localized
 * label is already right and overriding it would lose the translation.
 *
 * Why APP_DISPLAY_NAME and not `title`: the roles name the product, while the
 * title carries the per-branch dev label. "Quit Orca Lab: my-branch" is wrong.
 */
export function createMacAppMenu(options: MacAppMenuOptions): Electron.MenuItemConstructorOptions {
  const name = APP_DISPLAY_NAME
  return {
    label: options.title ?? app.name,
    submenu: [
      { role: 'about', label: translateMain('menu.about', 'About {{name}}', { name }) },
      options.checkForUpdatesItem,
      options.settingsItem,
      { type: 'separator' },
      { role: 'services' },
      { type: 'separator' },
      { role: 'hide', label: translateMain('menu.hide', 'Hide {{name}}', { name }) },
      { role: 'hideOthers' },
      { role: 'unhide' },
      { type: 'separator' },
      { role: 'quit', label: translateMain('menu.quit', 'Quit {{name}}', { name }) }
    ]
  }
}
