// Split out of register-app-menu.ts: the merged file crossed the 300-line cap.
// The Appearance submenu's toggle state is a self-contained slice.
export type AppearanceMenuState = {
  showTasksButton: boolean
  showAutomationsButton: boolean
  showMobileButton: boolean
  showTitlebarAppName: boolean
  statusBarVisible: boolean
}

export type AppearanceMenuKey = keyof AppearanceMenuState

/** Appearance toggles default to on, so an unset value flips to off first. */
export function getNextDefaultOnAppearanceSettingValue(current: boolean | undefined): boolean {
  return !(current !== false)
}
