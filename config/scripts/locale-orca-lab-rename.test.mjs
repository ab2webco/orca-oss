import fs from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  LOCALE_KEY_OVERRIDES,
  LOCALE_VALUE_OVERRIDES,
  collectStringLeaves,
  repairTranslatedValue,
  shouldPreserveEnglishValue
} from './locale-translation-policy.mjs'

const LOCALES_DIR = path.join(
  import.meta.dirname,
  '..',
  '..',
  'src',
  'renderer',
  'src',
  'i18n',
  'locales'
)
const EN_CATALOG = JSON.parse(fs.readFileSync(path.join(LOCALES_DIR, 'en.json'), 'utf8'))
const EN_LEAVES = collectStringLeaves(EN_CATALOG)
const EN_VALUE_BY_KEY = new Map(EN_LEAVES.map((leaf) => [leaf.key, leaf.value]))
const EN_VALUES = new Set(EN_LEAVES.map((leaf) => leaf.value))

// ORCA-392: capital "Orca" became "Orca Lab" except the separately-named products and file paths.
const ORCA_RENAME = /\bOrca\b(?! (?:Lab|Cloud|Relay))(?!\.(?:app|exe))/g
function renameToOrcaLab(text) {
  return text.replace(ORCA_RENAME, (match, offset, whole) =>
    whole.slice(Math.max(0, offset - 6), offset) === 'GNOME ' ? match : 'Orca Lab'
  )
}

describe('ORCA-392 "Orca Lab" rename', () => {
  it('pins the product name so a bootstrap run never sends it to machine translation', () => {
    expect(shouldPreserveEnglishValue('Orca')).toBe(true)
    expect(shouldPreserveEnglishValue('Orca Lab')).toBe(true)
  })

  it('restores a machine-translated "Lab" instead of leaving a half-translated product name', () => {
    const cases = [
      { locale: 'zh', localeValue: '无法连接到 Orca 实验室。' },
      { locale: 'zh', localeValue: '无法连接到虎鲸实验室。' },
      { locale: 'ja', localeValue: 'Orca ラボ に接続できません。' },
      { locale: 'ja', localeValue: 'シャチラボに接続できません。' },
      { locale: 'ko', localeValue: 'Orca 랩에 연결할 수 없습니다.' },
      { locale: 'ko', localeValue: '오르카 랩에 연결할 수 없습니다.' },
      { locale: 'es', localeValue: 'No se puede conectar con Laboratorio Orca.' }
    ]
    for (const { locale, localeValue } of cases) {
      const repaired = repairTranslatedValue({
        key: 'auto.web.WebConnect.remotePairingUnreachable',
        enValue: 'Cannot reach Orca Lab at {{endpoint}}.',
        localeValue,
        locale
      })
      expect(repaired).toContain('Orca Lab')
    }
  })

  it('keeps a renamed key override instead of reverting the catalog to "Orca"', () => {
    expect(
      repairTranslatedValue({
        key: 'auto.components.github.project.ProjectViewWrapper.1850fceac8',
        enValue:
          "{{value0}}/{{value1}} isn't added to Orca Lab. Add it to start work, or open in GitHub.",
        localeValue: '{{value0}}/{{value1}}이(가) Orca Lab에 추가되어 있지 않습니다.',
        locale: 'ko'
      })
    ).toContain('Orca Lab에')
  })

  it('keeps the pinned Spanish translation reachable under the renamed English key', () => {
    expect(LOCALE_VALUE_OVERRIDES.es['Explore Orca Lab']).toBe('Explorar Orca Lab')
    expect(LOCALE_VALUE_OVERRIDES.es['Explore Orca']).toBeUndefined()
  })

  it('leaves no value override orphaned by the rename', () => {
    const orphaned = []
    for (const [locale, overrides] of Object.entries(LOCALE_VALUE_OVERRIDES)) {
      for (const englishKey of Object.keys(overrides)) {
        if (EN_VALUES.has(englishKey)) {
          continue
        }
        const renamed = renameToOrcaLab(englishKey)
        if (renamed !== englishKey && EN_VALUES.has(renamed)) {
          orphaned.push(`${locale}: ${englishKey}`)
        }
      }
    }
    expect(orphaned).toEqual([])
  })

  it('leaves no key override still saying "Orca" where en.json says "Orca Lab"', () => {
    const stale = []
    for (const [key, byLocale] of Object.entries(LOCALE_KEY_OVERRIDES)) {
      const enValue = EN_VALUE_BY_KEY.get(key)
      if (enValue === undefined || !enValue.includes('Orca Lab')) {
        continue
      }
      for (const [locale, value] of Object.entries(byLocale)) {
        if (typeof value === 'string' && value.includes('Orca') && !value.includes('Orca Lab')) {
          stale.push(`${key} [${locale}]`)
        }
      }
    }
    expect(stale).toEqual([])
  })
})
