import fs from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

const REPO_ROOT = path.join(import.meta.dirname, '..', '..')

// Split so this file is not itself a match for the needles it searches for.
const ORCA_VIEWBOX = '318.60' + '232 202.66667'
const ORCA_PATH_START = 'm 177.81311,' + '248.33334'
const ORCA_NEEDLES = [ORCA_VIEWBOX, ORCA_PATH_START]

const AB2WEB_VIEWBOX = '0 0 318 231'
const AB2WEB_ORANGE = '#FF8300'

const SCANNED_ROOTS = ['src', 'mobile/src', 'resources']
const SCANNED_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.mjs', '.css', '.svg', '.json', '.html'])
const SKIPPED_DIRECTORIES = new Set(['node_modules', 'dist', 'out', 'build', '.expo'])

// ORCA-434 slice 2: the app-icon source still holds the orca until the icon
// pipeline is regenerated (needs Xcode actool + ImageMagick). Delete this entry
// when the icon slice lands so the guard covers the whole tree.
const PENDING_ICON_SOURCE = path.join('resources', 'icon-source')

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
      const relative = path.relative(REPO_ROOT, absolute)
      if (relative.startsWith(PENDING_ICON_SOURCE)) {
        continue
      }
      files.push({ relative, absolute })
    }
  }
  return files
}

function readText(absolute) {
  return fs.readFileSync(absolute, 'utf8')
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
})
