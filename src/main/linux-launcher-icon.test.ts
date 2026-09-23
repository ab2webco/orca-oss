import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  app: { isPackaged: true, getPath: () => '/opt/Orca/orca-ide' }
}))

vi.mock('@electron-toolkit/utils', () => ({
  is: { dev: false }
}))

import { persistLinuxLauncherIcon, whenLinuxLauncherIconSettled } from './linux-launcher-icon'

const SIZES = [16, 24, 32, 48, 64, 128, 256, 512]

function createImage(tag: string): Electron.NativeImage {
  return {
    resize: ({ width }: { width: number }) => ({ toPNG: () => Buffer.from(`${tag}-${width}`) })
  } as unknown as Electron.NativeImage
}

function iconPath(dataHome: string, size: number): string {
  return join(dataHome, 'icons', 'hicolor', `${size}x${size}`, 'apps', 'orca-ide.png')
}

describe('persistLinuxLauncherIcon', () => {
  let dataHome: string

  beforeEach(async () => {
    dataHome = await mkdtemp(join(tmpdir(), 'orca-launcher-icon-'))
  })

  afterEach(async () => {
    await rm(dataHome, { recursive: true, force: true })
  })

  it('writes every hicolor size under the launcher icon name', async () => {
    persistLinuxLauncherIcon('watercolor', createImage('water'), { dataHome, platform: 'linux' })
    await whenLinuxLauncherIconSettled()

    for (const size of SIZES) {
      expect((await readFile(iconPath(dataHome, size))).toString()).toBe(`water-${size}`)
    }
  })

  it('removes the user icons when switching back to classic', async () => {
    persistLinuxLauncherIcon('blue', createImage('blue'), { dataHome, platform: 'linux' })
    persistLinuxLauncherIcon('classic', createImage('classic'), { dataHome, platform: 'linux' })
    await whenLinuxLauncherIconSettled()

    for (const size of SIZES) {
      await expect(stat(iconPath(dataHome, size))).rejects.toThrow()
    }
  })

  it('drops a stale queued choice in favour of the latest one', async () => {
    persistLinuxLauncherIcon('blue', createImage('blue'), { dataHome, platform: 'linux' })
    persistLinuxLauncherIcon('watercolor', createImage('water'), { dataHome, platform: 'linux' })
    await whenLinuxLauncherIconSettled()

    expect((await readFile(iconPath(dataHome, 512))).toString()).toBe('water-512')
  })

  it('leaves identical icons untouched on restart', async () => {
    persistLinuxLauncherIcon('blue', createImage('blue'), { dataHome, platform: 'linux' })
    await whenLinuxLauncherIconSettled()
    const before = (await stat(iconPath(dataHome, 32))).mtimeMs
    await new Promise((resolve) => setTimeout(resolve, 20))

    persistLinuxLauncherIcon('blue', createImage('blue'), { dataHome, platform: 'linux' })
    await whenLinuxLauncherIconSettled()

    expect((await stat(iconPath(dataHome, 32))).mtimeMs).toBe(before)
  })

  it('does nothing outside packaged non-AppImage Linux', async () => {
    const image = createImage('blue')
    persistLinuxLauncherIcon('blue', image, { dataHome, platform: 'darwin' })
    persistLinuxLauncherIcon('blue', image, { dataHome, platform: 'win32' })
    persistLinuxLauncherIcon('blue', image, { dataHome, platform: 'linux', isDevApp: true })
    persistLinuxLauncherIcon('blue', image, { dataHome, platform: 'linux', isAppImage: true })
    await whenLinuxLauncherIconSettled()

    await expect(stat(join(dataHome, 'icons'))).rejects.toThrow()
  })

  it('treats an unknown icon id as classic', async () => {
    persistLinuxLauncherIcon('missing', createImage('x'), { dataHome, platform: 'linux' })
    await whenLinuxLauncherIconSettled()

    await expect(stat(iconPath(dataHome, 512))).rejects.toThrow()
  })
})
