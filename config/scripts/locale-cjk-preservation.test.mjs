import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const CJK = /[㐀-鿿豈-﫿぀-ヿ가-힯]/
const CJK_LOCALES = ['zh', 'ja', 'ko']

// Why una allowlist y no una regla: de-traducir SÍ es correcto cuando el valor es un
// literal, una ruta, un nombre de binario o una mistranslation. Lo que no puede pasar
// en silencio es que copy real pierda su idioma. Cada entrada acá es una decisión
// tomada a mano, no un bloque. ORCA-392.
const DE_TRANSLATION_ALLOWED = new Set([
  // Mistranslations que este PR arregla: 医学博士 es "Doctor en Medicina" y venia del
  // MD de Markdown; 壮举 es "hazaña heroica" y venia del feat de un nombre de rama.
  // Son literales, no copy, asi que perder el chino aca es lo correcto.
  'zh:auto.components.right.sidebar.SourceControl.94c42b252e',
  'zh:auto.components.mobile.slides.TerminalSlide.e0f98be657',
  'zh:auto.components.mobile.slides.TerminalSlide.8432787c4e'
])

function baselineCatalog(locale) {
  try {
    return JSON.parse(
      execFileSync('git', ['show', `origin/main:src/renderer/src/i18n/locales/${locale}.json`], {
        encoding: 'utf-8',
        maxBuffer: 64 * 1024 * 1024
      })
    )
  } catch {
    return null
  }
}

function flatten(node, path, out) {
  for (const [key, value] of Object.entries(node ?? {})) {
    const next = path ? `${path}.${key}` : key
    if (value && typeof value === 'object') {
      flatten(value, next, out)
    } else if (typeof value === 'string') {
      out.set(next, value)
    }
  }
  return out
}

describe('los catalogos CJK no pierden su idioma', () => {
  it.each(CJK_LOCALES)('%s conserva los caracteres CJK que ya tenia en main', (locale) => {
    const baseline = baselineCatalog(locale)
    // Why no falla: sin `origin/main` (checkout somero, fork sin remoto) no hay
    // linea base contra la que comparar, y una guarda que invente una es peor.
    if (baseline === null) {
      return
    }
    const before = flatten(baseline, '', new Map())
    const after = flatten(
      JSON.parse(readFileSync(`src/renderer/src/i18n/locales/${locale}.json`, 'utf-8')),
      '',
      new Map()
    )

    const lost = []
    for (const [key, oldValue] of before) {
      const newValue = after.get(key)
      if (typeof newValue !== 'string') {
        continue
      }
      if (!CJK.test(oldValue) || CJK.test(newValue)) {
        continue
      }
      if (DE_TRANSLATION_ALLOWED.has(`${locale}:${key}`)) {
        continue
      }
      lost.push(`${key}: ${JSON.stringify(oldValue)} -> ${JSON.stringify(newValue)}`)
    }

    expect(lost).toEqual([])
  })
})
