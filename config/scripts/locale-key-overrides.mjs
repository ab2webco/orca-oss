import { CONSENT_SURFACE_KEY_OVERRIDES } from './locale-consent-surface-key-overrides.mjs'
import { CROSS_LOCALE_KEY_OVERRIDES } from './locale-cross-locale-key-overrides.mjs'
import { MACOS_TCC_KEY_OVERRIDES } from './locale-macos-tcc-key-overrides.mjs'

function mergeByKey(...sources) {
  const merged = {}
  for (const source of sources) {
    for (const [key, overrides] of Object.entries(source)) {
      merged[key] = { ...merged[key], ...overrides }
    }
  }
  return merged
}

// Why: some fixes depend on the full key context, not the English value alone.
export const LOCALE_KEY_OVERRIDES = mergeByKey(
  CROSS_LOCALE_KEY_OVERRIDES,
  MACOS_TCC_KEY_OVERRIDES,
  CONSENT_SURFACE_KEY_OVERRIDES
)
