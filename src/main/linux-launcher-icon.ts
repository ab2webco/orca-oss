import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, isAbsolute, join } from 'node:path'
import { app, type NativeImage } from 'electron'
import { is } from '@electron-toolkit/utils'
import { normalizeAppIconId } from '../shared/app-icon'

// Same sizes electron-builder emits for the package's hicolor icons. A partial
// set would leave the launcher mixing our icon with the packaged one per size.
const HICOLOR_SIZES = [16, 24, 32, 48, 64, 128, 256, 512] as const

type PersistLinuxLauncherIconOptions = {
  dataHome?: string
  iconName?: string
  isAppImage?: boolean
  isDevApp?: boolean
  platform?: NodeJS.Platform
}

let persistenceGeneration = 0
let persistenceQueue = Promise.resolve()

function getUserDataHome(): string {
  const xdgDataHome = process.env.XDG_DATA_HOME
  return xdgDataHome && isAbsolute(xdgDataHome) ? xdgDataHome : join(homedir(), '.local', 'share')
}

function getHicolorIconPath(dataHome: string, iconName: string, size: number): string {
  return join(dataHome, 'icons', 'hicolor', `${size}x${size}`, 'apps', `${iconName}.png`)
}

async function writeLauncherIcons(
  image: NativeImage,
  dataHome: string,
  iconName: string
): Promise<void> {
  for (const size of HICOLOR_SIZES) {
    const iconPath = getHicolorIconPath(dataHome, iconName, size)
    const png = image.resize({ width: size, height: size, quality: 'best' }).toPNG()
    const existing = await readFile(iconPath).catch(() => null)
    // Why: launchers reload their icon cache on every write, so skip identical ones on startup.
    if (existing?.equals(png)) {
      continue
    }
    await mkdir(join(iconPath, '..'), { recursive: true })
    await writeFile(iconPath, png)
  }
}

async function removeLauncherIcons(dataHome: string, iconName: string): Promise<void> {
  await Promise.all(
    HICOLOR_SIZES.map((size) => rm(getHicolorIconPath(dataHome, iconName, size), { force: true }))
  )
}

// Why: GNOME/Wayland ignore BrowserWindow.setIcon and take the icon from the
// launcher's `Icon=` name. A user-level hicolor icon of that name outranks the
// packaged one without root and survives package upgrades.
export function persistLinuxLauncherIcon(
  value: unknown,
  image: NativeImage,
  options: PersistLinuxLauncherIconOptions = {}
): void {
  const platform = options.platform ?? process.platform
  const isDevApp = options.isDevApp ?? (is.dev || !app.isPackaged)
  // Why: an AppImage has no packaged hicolor icon to override, and its name is not the launcher's.
  const isAppImage = options.isAppImage ?? Boolean(process.env.APPIMAGE)
  if (platform !== 'linux' || isDevApp || isAppImage) {
    return
  }
  // Why: the packaged .desktop uses `Icon=<executableName>`, which is the exe basename.
  const iconName = options.iconName ?? basename(app.getPath('exe'))
  const dataHome = options.dataHome ?? getUserDataHome()
  const iconId = normalizeAppIconId(value)
  const generation = ++persistenceGeneration
  persistenceQueue = persistenceQueue
    .then(async () => {
      // Why: a stale queued write must not reapply an older icon choice.
      if (generation !== persistenceGeneration) {
        return
      }
      if (iconId === 'classic') {
        await removeLauncherIcons(dataHome, iconName)
        return
      }
      await writeLauncherIcons(image, dataHome, iconName)
    })
    .catch((error) => {
      console.warn('[app-icon] failed to persist Linux launcher icon:', error)
    })
}

export function whenLinuxLauncherIconSettled(): Promise<void> {
  return persistenceQueue
}
