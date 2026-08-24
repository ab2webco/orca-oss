import { execFileSync } from 'node:child_process'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

import { collectGateFindings, isCriticalKey } from './verify-localization-new-key-gate.mjs'

const LOCALES = ['es', 'ja', 'ko', 'zh']

function locales(keysByLocale) {
  return Object.fromEntries(LOCALES.map((locale) => [locale, new Set(keysByLocale[locale] ?? [])]))
}

describe('localization new-key gate', () => {
  it('blocks a key the change adds without translations', () => {
    const { addedKeys, addedUntranslated } = collectGateFindings({
      baseEnKeys: new Set(['a.existing']),
      headEnKeys: new Set(['a.existing', 'a.brandNew']),
      localeKeysByName: locales({
        es: ['a.existing'],
        ja: ['a.existing'],
        ko: ['a.existing'],
        zh: ['a.existing']
      })
    })
    expect(addedKeys).toEqual(['a.brandNew'])
    expect(addedUntranslated.map((finding) => finding.locale).sort()).toEqual(LOCALES)
  })

  it('passes the same key once every locale has it', () => {
    const { addedUntranslated } = collectGateFindings({
      baseEnKeys: new Set(['a.existing']),
      headEnKeys: new Set(['a.existing', 'a.brandNew']),
      localeKeysByName: locales({
        es: ['a.existing', 'a.brandNew'],
        ja: ['a.existing', 'a.brandNew'],
        ko: ['a.existing', 'a.brandNew'],
        zh: ['a.existing', 'a.brandNew']
      })
    })
    expect(addedUntranslated).toEqual([])
  })

  // The whole point of the added-key shape: the 757-key debt must not block a PR
  // that did not create it, or the gate gets turned off (ORCA-284).
  it('ignores untranslated keys the change did not add', () => {
    const { addedKeys, addedUntranslated } = collectGateFindings({
      baseEnKeys: new Set(['a.oldDebt', 'a.alsoOld']),
      headEnKeys: new Set(['a.oldDebt', 'a.alsoOld']),
      localeKeysByName: locales({})
    })
    expect(addedKeys).toEqual([])
    expect(addedUntranslated).toEqual([])
  })

  it('blocks an untranslated consent surface even when the change did not add it', () => {
    const { addedUntranslated, criticalUntranslated } = collectGateFindings({
      baseEnKeys: new Set(['x.PluginConsentDialog.networkAccessNote']),
      headEnKeys: new Set(['x.PluginConsentDialog.networkAccessNote']),
      localeKeysByName: locales({})
    })
    expect(addedUntranslated).toEqual([])
    expect(criticalUntranslated).toHaveLength(LOCALES.length)
  })

  it('treats an unreadable base as all-pre-existing rather than all-new', () => {
    const { addedKeys, addedUntranslated } = collectGateFindings({
      baseEnKeys: null,
      headEnKeys: new Set(['a.one', 'a.two']),
      localeKeysByName: locales({})
    })
    expect(addedKeys).toEqual([])
    expect(addedUntranslated).toEqual([])
  })

  it('recognizes the consent and warning surfaces, and leaves ordinary copy alone', () => {
    expect(isCriticalKey('x.PluginConsentDialog.networkAccessNote')).toBe(true)
    expect(isCriticalKey('x.DeveloperPermissionsPane.statusGranted')).toBe(true)
    expect(isCriticalKey('x.ReleaseChannelSection.dailyWarning')).toBe(true)
    expect(isCriticalKey('x.SomePane.tooltipHint')).toBe(false)
  })
})

// Why a real process and not just collectGateFindings: the whole ORCA-284 defect
// was a verifier that FOUND everything and exited 0. Asserting the findings alone
// leaves that exact bug uncovered — swapping `return 1` for `return 0` kept the
// finding tests green.
describe('localization new-key gate exit code', () => {
  const GATE = path.resolve(import.meta.dirname, 'verify-localization-new-key-gate.mjs')

  async function repoWithCatalogs(en, byLocale) {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'orca-l10n-gate-'))
    const localesDir = path.join(root, 'src', 'renderer', 'src', 'i18n', 'locales')
    await fs.mkdir(localesDir, { recursive: true })
    const git = (...args) => execFileSync('git', args, { cwd: root, stdio: 'pipe' })
    git('init', '-q')
    git('config', 'user.email', 'gate@test.local')
    git('config', 'user.name', 'Gate Test')
    const write = async (name, value) =>
      fs.writeFile(path.join(localesDir, name), `${JSON.stringify(value, null, 2)}\n`, 'utf8')
    await write('en.json', en.base)
    for (const [locale, value] of Object.entries(byLocale)) {
      await write(`${locale}.json`, value)
    }
    git('add', '-A')
    git('commit', '-q', '-m', 'base catalogs')
    const baseSha = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: root,
      encoding: 'utf8'
    }).trim()
    await write('en.json', en.head)
    git('add', '-A')
    // --allow-empty: a debt-only case has identical base and head catalogs, and
    // git refuses an empty commit by default.
    git('commit', '-q', '--allow-empty', '-m', 'head catalogs')
    return { root, baseSha }
  }

  function runGate(root, baseSha) {
    const result = execFileSync(process.execPath, [GATE, baseSha], {
      cwd: root,
      encoding: 'utf8',
      stdio: 'pipe'
    })
    return { status: 0, output: result }
  }

  function runGateExpectingFailure(root, baseSha) {
    try {
      execFileSync(process.execPath, [GATE, baseSha], {
        cwd: root,
        encoding: 'utf8',
        stdio: 'pipe'
      })
    } catch (error) {
      return { status: error.status, output: `${error.stdout ?? ''}${error.stderr ?? ''}` }
    }
    return { status: 0, output: '' }
  }

  const TRANSLATED = { existing: 'ya traducido' }

  it('exits non-zero when the change adds an untranslated key', async () => {
    const { root, baseSha } = await repoWithCatalogs(
      { base: { existing: 'Existing' }, head: { existing: 'Existing', brandNew: 'Brand new' } },
      { es: TRANSLATED, ja: TRANSLATED, ko: TRANSLATED, zh: TRANSLATED }
    )
    const { status, output } = runGateExpectingFailure(root, baseSha)
    expect(status).toBe(1)
    expect(output).toContain('brandNew')
  })

  it('exits zero once that key is translated everywhere', async () => {
    const translated = { existing: 'ya traducido', brandNew: 'nuevo' }
    const { root, baseSha } = await repoWithCatalogs(
      { base: { existing: 'Existing' }, head: { existing: 'Existing', brandNew: 'Brand new' } },
      { es: translated, ja: translated, ko: translated, zh: translated }
    )
    expect(runGate(root, baseSha).status).toBe(0)
  })

  it('exits zero on pre-existing untranslated debt it did not add', async () => {
    const { root, baseSha } = await repoWithCatalogs(
      { base: { oldDebt: 'Old', more: 'More' }, head: { oldDebt: 'Old', more: 'More' } },
      { es: {}, ja: {}, ko: {}, zh: {} }
    )
    expect(runGate(root, baseSha).status).toBe(0)
  })
})
