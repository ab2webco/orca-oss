import { execFileSync, spawnSync } from 'node:child_process'
import fs from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { pathToFileURL } from 'node:url'

import { resolvePullRequestDiffBase } from './git-pull-request-diff-base.mjs'

// Blocks a PR that ADDS untranslated keys, and never asks anything of the debt
// already on main (ORCA-284). Why not a coverage threshold: it cannot tell a new
// key from an old one, so the number can be made to move by translating whatever
// is easiest while the screen the user just got stays English.
//
// The critical set is separate on purpose. A permission or a warning the user
// cannot read is a different class of defect from a tooltip: they decide with
// incomplete information, which is the bug ORCA-277 describes. Those keys must be
// complete in every locale — including the ones already on main.

const LOCALES_RELATIVE_DIR = path.join('src', 'renderer', 'src', 'i18n', 'locales')
const EN_CATALOG = path.join(LOCALES_RELATIVE_DIR, 'en.json')

/** Consent, permission and warning surfaces. Matched on the key path, which is
 *  derived from the component that renders it, so a new dialog lands here by
 *  living in a file whose name says what it is. */
const CRITICAL_KEY_PATTERN = /consent|permission|capability|destructive|trust|warning/i

function runGit(root, args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
}

function resolveBase(root, requestedBase) {
  for (const candidate of [
    requestedBase,
    process.env.ORCA_LOCALIZATION_GATE_BASE,
    process.env.ORCA_CODE_QUALITY_BASE,
    'origin/main',
    'main'
  ]) {
    if (!candidate) {
      continue
    }
    const probe = spawnSync('git', ['rev-parse', '--verify', `${candidate}^{commit}`], {
      cwd: root,
      stdio: 'ignore'
    })
    if (probe.status === 0) {
      return candidate
    }
  }
  return null
}

export function flattenCatalog(value, prefix = '') {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return prefix ? new Map([[prefix, value]]) : new Map()
  }
  const entries = new Map()
  for (const [key, child] of Object.entries(value)) {
    for (const [flatKey, flatValue] of flattenCatalog(child, prefix ? `${prefix}.${key}` : key)) {
      entries.set(flatKey, flatValue)
    }
  }
  return entries
}

export function isCriticalKey(key) {
  return CRITICAL_KEY_PATTERN.test(key)
}

/**
 * Keys a change adds, and which locales are missing them.
 *
 * `baseEnKeys` null means the base catalog could not be read — treat every key as
 * pre-existing rather than reporting the whole catalog as new.
 */
export function collectGateFindings({ baseEnKeys, headEnKeys, localeKeysByName }) {
  const addedKeys = baseEnKeys === null ? [] : [...headEnKeys].filter((key) => !baseEnKeys.has(key))
  const addedUntranslated = []
  const criticalUntranslated = []

  for (const [localeName, localeKeys] of Object.entries(localeKeysByName)) {
    for (const key of addedKeys) {
      if (!localeKeys.has(key)) {
        addedUntranslated.push({ key, locale: localeName })
      }
    }
    for (const key of headEnKeys) {
      if (isCriticalKey(key) && !localeKeys.has(key)) {
        criticalUntranslated.push({ key, locale: localeName })
      }
    }
  }
  return { addedKeys, addedUntranslated, criticalUntranslated }
}

function formatFindings(findings, limit = 20) {
  const byKey = new Map()
  for (const { key, locale } of findings) {
    byKey.set(key, [...(byKey.get(key) ?? []), locale])
  }
  const lines = [...byKey.entries()]
    .slice(0, limit)
    .map(([key, locales]) => `  ${key} — missing in ${locales.sort().join(', ')}`)
  if (byKey.size > limit) {
    lines.push(`  ...and ${byKey.size - limit} more keys`)
  }
  return lines.join('\n')
}

async function readCatalogKeys(absolutePath) {
  try {
    return flattenCatalog(JSON.parse(await fs.readFile(absolutePath, 'utf8')))
  } catch {
    return null
  }
}

function readCatalogKeysAtRef(root, ref, relativePath) {
  try {
    return flattenCatalog(JSON.parse(runGit(root, ['show', `${ref}:${relativePath}`])))
  } catch {
    return null
  }
}

export async function main(root = process.cwd(), argv = process.argv.slice(2)) {
  const requestedBase = argv.find((arg) => !arg.startsWith('--'))
  const localesDir = path.join(root, LOCALES_RELATIVE_DIR)
  const headEn = await readCatalogKeys(path.join(root, EN_CATALOG))
  if (!headEn) {
    console.error(`Could not read ${EN_CATALOG}.`)
    return 1
  }

  const localeFiles = (await fs.readdir(localesDir))
    .filter(
      (name) =>
        name.endsWith('.json') &&
        name !== 'en.json' &&
        !name.startsWith('.') &&
        !name.includes('-catalog-cache')
    )
    .sort()
  const localeKeysByName = {}
  for (const fileName of localeFiles) {
    const keys = await readCatalogKeys(path.join(localesDir, fileName))
    if (keys) {
      localeKeysByName[fileName.replace(/\.json$/, '')] = keys
    }
  }

  const base = resolveBase(root, requestedBase)
  let baseEnKeys = null
  if (base) {
    const mergeBase = runGit(root, ['merge-base', base, 'HEAD']).trim()
    // syncAware: on a sync PR the pre-sync tip hides the fork's own additions,
    // the same blind spot ORCA-205 found in the changed-code gate.
    const comparisonBase = resolvePullRequestDiffBase(root, mergeBase, undefined, {
      syncAware: true
    })
    baseEnKeys = readCatalogKeysAtRef(root, comparisonBase, EN_CATALOG)
  }
  if (baseEnKeys === null) {
    console.log(
      'No comparable base catalog; skipping the added-key gate and checking critical surfaces only.'
    )
  }

  const { addedKeys, addedUntranslated, criticalUntranslated } = collectGateFindings({
    baseEnKeys,
    headEnKeys: new Set(headEn.keys()),
    localeKeysByName: Object.fromEntries(
      Object.entries(localeKeysByName).map(([name, keys]) => [name, new Set(keys.keys())])
    )
  })

  let failed = false
  if (criticalUntranslated.length > 0) {
    failed = true
    console.error('Consent, permission and warning keys must be translated in every locale.')
    console.error('A user approving a permission they cannot read decides on partial information.')
    console.error('')
    console.error(formatFindings(criticalUntranslated))
    console.error('')
  }
  if (addedUntranslated.length > 0) {
    failed = true
    console.error(`This change adds ${addedKeys.length} localization key(s) without translations.`)
    console.error('Translate them in every locale; the existing debt is deliberately out of scope.')
    console.error('')
    console.error(formatFindings(addedUntranslated))
    console.error('')
  }
  if (failed) {
    return 1
  }

  console.log(
    `Localization gate passed: ${addedKeys.length} added key(s) translated in ${Object.keys(localeKeysByName).length} locale(s), critical surfaces complete.`
  )
  return 0
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(await main())
}
