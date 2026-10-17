import { describe, expect, it } from 'vitest'

import en from './locales/en.json'
import es from './locales/es.json'

const repairedEntries = [
  ['es', 'auto.components.sidebar.AddRepoCreateStep.0ae45b8238'],
  ['es', 'auto.components.settings.IntegrationsPane.e74de656ce'],
  ['es', 'auto.components.settings.IntegrationsPane.51000487c4'],
  ['es', 'auto.components.settings.RepositoryHooksSection.925f9e0dc4'],
  ['es', 'auto.components.settings.RepositoryHooksSection.c90b858573'],
  ['es', 'auto.components.settings.RepositoryHooksSection.32f417fe17'],
  ['es', 'auto.components.settings.RepositoryIconPicker.03ca1a4e9b'],
  ['es', 'auto.components.right.sidebar.index.6306b48afd'],
  ['es', 'auto.components.feature.wall.ReviewAnimatedVisual.8df4d52b68'],
  ['es', 'auto.components.editor.CombinedDiffViewer.8368d256ec'],
  ['es', 'auto.components.editor.MarkdownTemplatePicker.22cd94426f']
] as const

const catalogs = { es } as const

function readValue(catalog: object, key: string): unknown {
  return key.split('.').reduce<unknown>((value, part) => {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      return undefined
    }
    return (value as Record<string, unknown>)[part]
  }, catalog)
}

describe('technical literal catalog repairs (#13121)', () => {
  it('keeps every repaired value identical to English', () => {
    expect(repairedEntries).toHaveLength(11)

    for (const [locale, key] of repairedEntries) {
      expect(readValue(catalogs[locale], key), `${locale}:${key}`).toBe(readValue(en, key))
    }
  })
})
