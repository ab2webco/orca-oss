import fs from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import { decodePng } from './trim-windows-icon-source.mjs'

const REPO_ROOT = path.join(import.meta.dirname, '..', '..')

// Split so this file is not itself a match for the needles it searches for.
const ORCA_VIEWBOX = '318.60' + '232 202.66667'
const ORCA_PATH_START = 'm 177.81311,' + '248.33334'
const ORCA_NEEDLES = [ORCA_VIEWBOX, ORCA_PATH_START]

const AB2WEB_VIEWBOX = '0 0 318 231'
const AB2WEB_ICON_VIEWBOX = '0 0 1000 1000'
const AB2WEB_ORANGE = '#FF8300'

const ICON_SOURCE_SVG = 'resources/icon-source/icon.icon/Assets/logo.svg'

// Every icon the app ships. The .icns is not here: its slots are an Apple
// container this guard has no decoder for, so it stays uncovered.
const SHIPPED_ICON_PNGS = [
  'resources/build/icon.png',
  'resources/icon.png',
  'resources/icon-dev.png',
  // The two icons the user can pick in Settings, each also the macOS dock icon.
  'resources/app-icons/orca-blue.png',
  'resources/app-icons/orca-watercolor.png',
  'mobile/assets/icon.png',
  'mobile/assets/adaptive-icon.png',
  'mobile/assets/splash-icon.png',
  'mobile/assets/favicon.png'
]

// The macOS menu bar item. Excluded from the orange check on purpose: a Template
// image is black plus alpha, and macOS recolours it — colour here would ship a
// wrongly painted tray icon (ORCA-438).
const TEMPLATE_ICON_PNGS = [
  'resources/tray/orca-menu-barTemplate.png',
  'resources/tray/orca-menu-barTemplate@2x.png'
]

// Why: the Icon Composer render adds a specular gradient and anti-aliasing, so
// #FF8300 itself is mostly absent. Match the hue band it spreads into instead.
const ORANGE_HUE_RANGE = [20, 45]
const ORANGE_MIN_SATURATION = 0.45
const ORANGE_MIN_VALUE = 0.35
const OPAQUE_ALPHA = 200
// No shipped icon had a single pixel in this band before the symbol landed; the
// thinnest one now sits at 19%.
const MIN_ORANGE_SHARE = 0.1

const SCANNED_ROOTS = ['src', 'mobile/src', 'resources']
const SCANNED_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.mjs', '.css', '.svg', '.json', '.html'])
const SKIPPED_DIRECTORIES = new Set(['node_modules', 'dist', 'out', 'build', '.expo'])

function* walk(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name)
    if (entry.isDirectory()) {
      if (SKIPPED_DIRECTORIES.has(entry.name)) {
        continue
      }
      yield* walk(absolute)
      continue
    }
    if (entry.isFile() && SCANNED_EXTENSIONS.has(path.extname(entry.name))) {
      yield absolute
    }
  }
}

function scannedFiles() {
  const files = []
  for (const root of SCANNED_ROOTS) {
    const absoluteRoot = path.join(REPO_ROOT, root)
    if (!fs.existsSync(absoluteRoot)) {
      continue
    }
    for (const absolute of walk(absoluteRoot)) {
      files.push({ relative: path.relative(REPO_ROOT, absolute), absolute })
    }
  }
  return files
}

function readText(absolute) {
  return fs.readFileSync(absolute, 'utf8')
}

function isBrandOrange(r, g, b) {
  const max = Math.max(r, g, b) / 255
  const min = Math.min(r, g, b) / 255
  const delta = max - min
  if (delta === 0 || max < ORANGE_MIN_VALUE || delta / max < ORANGE_MIN_SATURATION) {
    return false
  }
  const hue =
    max === r / 255
      ? (60 * (((g - b) / 255 / delta) % 6) + 360) % 360
      : max === g / 255
        ? 60 * ((b - r) / 255 / delta + 2)
        : 60 * ((r - g) / 255 / delta + 4)
  return hue >= ORANGE_HUE_RANGE[0] && hue <= ORANGE_HUE_RANGE[1]
}

function brandOrangeShare(buffer) {
  const { width, height, data } = decodePng(buffer)
  let opaque = 0
  let orange = 0
  for (let index = 0; index < width * height * 4; index += 4) {
    if (data[index + 3] < OPAQUE_ALPHA) {
      continue
    }
    opaque++
    if (isBrandOrange(data[index], data[index + 1], data[index + 2])) {
      orange++
    }
  }
  return opaque === 0 ? 0 : orange / opaque
}

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

// The ICO the build emits stores every frame as a PNG, so the largest one can be
// read back with the same decoder.
function largestIcoFrame(buffer) {
  const frames = []
  for (let entry = 0; entry < buffer.readUInt16LE(4); entry++) {
    const offset = 6 + entry * 16
    const bytes = buffer.readUInt32LE(offset + 8)
    const start = buffer.readUInt32LE(offset + 12)
    const frame = buffer.subarray(start, start + bytes)
    if (frame.subarray(0, 8).equals(PNG_SIGNATURE)) {
      frames.push(frame)
    }
  }
  return frames.sort((a, b) => b.length - a.length)[0]
}

describe('ORCA-434 Ab2Web symbol replaces the orca', () => {
  it('scans a non-empty set of files, so a passing sweep is not an empty one', () => {
    const files = scannedFiles()
    expect(files.length).toBeGreaterThan(100)
    expect(files.some((file) => file.relative === path.join('resources', 'logo.svg'))).toBe(true)
  })

  it('leaves no orca geometry anywhere the brand is drawn', () => {
    const offenders = []
    for (const { relative, absolute } of scannedFiles()) {
      const contents = readText(absolute)
      for (const needle of ORCA_NEEDLES) {
        if (contents.includes(needle)) {
          offenders.push(`${relative} (${needle})`)
        }
      }
    }
    expect(offenders).toEqual([])
  })

  it('draws the Ab2Web symbol at every brand surface', () => {
    const brandSurfaces = [
      'resources/logo.svg',
      'src/renderer/src/components/mobile/slides/HomeSlide.tsx',
      'src/renderer/src/components/stats/share-card-utils.tsx',
      'mobile/src/components/OrcaLogo.tsx'
    ]
    for (const relative of brandSurfaces) {
      const contents = readText(path.join(REPO_ROOT, relative))
      expect(contents, relative).toContain(AB2WEB_VIEWBOX)
    }
  })

  it('keeps the shipped asset and the share card on the brand orange', () => {
    expect(readText(path.join(REPO_ROOT, 'resources/logo.svg'))).toContain(AB2WEB_ORANGE)
    expect(
      readText(path.join(REPO_ROOT, 'src/renderer/src/components/stats/share-card-utils.tsx'))
    ).toContain(AB2WEB_ORANGE)
  })

  it('recolours the file-loaded logo by asset, never by a CSS inversion tuned to a white orca', () => {
    const inversionSites = [
      'src/renderer/src/components/settings/orca-logo-settings-icon.tsx',
      'src/renderer/src/components/sidebar/SidebarSettingsHelpMenu.tsx',
      'src/renderer/src/components/onboarding/OnboardingFlow.tsx'
    ]
    for (const relative of inversionSites) {
      expect(readText(path.join(REPO_ROOT, relative)), relative).not.toMatch(/\binvert\b/)
    }
    expect(readText(path.join(REPO_ROOT, 'src/renderer/src/assets/main.css'))).not.toMatch(
      /titlebar-logo[\s\S]*?invert\(1\)/
    )
  })

  it('sizes the mobile header logo on the square-ish symbol, not the wide orca', () => {
    const component = readText(path.join(REPO_ROOT, 'mobile/src/components/OrcaLogo.tsx'))
    expect(component).toContain('318 / 231')
  })

  it('feeds the app-icon pipeline the square symbol, not the wide brand lockup', () => {
    const source = readText(path.join(REPO_ROOT, ICON_SOURCE_SVG))
    expect(source).toContain(AB2WEB_ICON_VIEWBOX)
    expect(source).toContain(AB2WEB_ORANGE)
  })

  it('keeps the menu bar icon a monochrome template with real coverage', () => {
    for (const relative of TEMPLATE_ICON_PNGS) {
      const { width, height, data } = decodePng(fs.readFileSync(path.join(REPO_ROOT, relative)))
      let opaque = 0
      let coloured = 0
      for (let index = 0; index < width * height * 4; index += 4) {
        if (data[index + 3] < OPAQUE_ALPHA) {
          continue
        }
        opaque++
        const [r, g, b] = [data[index], data[index + 1], data[index + 2]]
        if (Math.max(r, g, b) - Math.min(r, g, b) > 12 || Math.max(r, g, b) > 96) {
          coloured++
        }
      }
      // A shape, not an empty canvas: the symbol covers a fifth of the box.
      expect(opaque / (width * height), relative).toBeGreaterThan(0.15)
      expect(coloured, relative).toBe(0)
    }
  })

  it('ships every icon raster on the brand orange, so a stale regenerate is visible', () => {
    const shares = {}
    for (const relative of SHIPPED_ICON_PNGS) {
      shares[relative] = brandOrangeShare(fs.readFileSync(path.join(REPO_ROOT, relative)))
    }
    const ico = path.join(REPO_ROOT, 'resources/build/icon.ico')
    shares['resources/build/icon.ico'] = brandOrangeShare(largestIcoFrame(fs.readFileSync(ico)))
    for (const [relative, share] of Object.entries(shares)) {
      expect(share, relative).toBeGreaterThan(MIN_ORANGE_SHARE)
    }
  })
})
