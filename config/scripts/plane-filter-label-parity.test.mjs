import path from 'node:path'
import { describe, expect, it } from 'vitest'

import { collectFallbacks, readCatalog } from './renderer-translate-fallbacks.mjs'
import { PLANE_WORK_ITEM_FILTER_LABELS } from '../../src/shared/plane-work-item-filter-labels'

const ROOT = path.resolve(import.meta.dirname, '../..')

/**
 * The desktop half of ORCA-460's control, and it has to read the SOURCE, not the
 * rendered label. `config/i18next.config.ts` extracts en.json from these very
 * `translate()` fallbacks, so the literal is upstream of the catalog: a rename
 * that only edits the literal would pass a test that reads the catalog, and
 * would then regenerate en.json into disagreement with mobile.
 *
 * Why the labels are not simply imported from the shared table here: this
 * parser only reads string literals, so a constant in that argument drops these
 * five calls out of `resolved-calls` and turns the ORCA-443 baseline red.
 */
const PRESET_KEYS = {
  everything: 'auto.components.TaskPage.planeAllPreset',
  assigned: 'auto.components.TaskPage.1301d376f1',
  created: 'auto.components.TaskPage.planeCreatedPreset',
  all: 'auto.components.TaskPage.4b6e40e42c',
  done: 'auto.components.TaskPage.18451e99df'
}

describe('the Plane filter labels desktop ships', () => {
  // Every call, not the last one: `all` and `done` share their keys with the Jira
  // presets, so a rename there moves Plane's label too and must land here.
  const fallbacks = collectFallbacks(ROOT)
  const catalogValue = readCatalog(ROOT)

  for (const [id, key] of Object.entries(PRESET_KEYS)) {
    it(`names '${id}' the way both clients name it, in source and in the catalog`, () => {
      const expected = PLANE_WORK_ITEM_FILTER_LABELS[id]

      const literals = fallbacks.filter((call) => call.key === key).map((call) => call.fallback)

      expect(literals, `${key} is no longer a literal translate() fallback`).not.toHaveLength(0)
      expect(new Set(literals)).toEqual(new Set([expected]))
      expect(catalogValue(key)).toBe(expected)
    })
  }
})
