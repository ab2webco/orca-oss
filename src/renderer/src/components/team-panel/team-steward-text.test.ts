import { describe, expect, it, vi } from 'vitest'
import { teamStewardVisitText } from './team-steward-text'

vi.mock('@/i18n/i18n', () => ({
  translate: (_key: string, fallback: string, options?: Record<string, unknown>) =>
    fallback.replace(/\{\{(\w+)\}\}/g, (_, name: string) => String(options?.[name] ?? ''))
}))

// ORCA-1242: what the steward says beside the member it visits in the scene.
describe('teamStewardVisitText', () => {
  it('says the pick it moved to, up or down, and why', () => {
    expect(
      teamStewardVisitText({ at: 1, lift: 'raise', to: 'Opus 5.5 · high', moment: 'edit' })
    ).toBe('Up to Opus 5.5 · high: editing code')
    expect(
      teamStewardVisitText({ at: 2, lift: 'lower', to: 'Haiku 5.5 · low', moment: 'pr-ci' })
    ).toBe('Down to Haiku 5.5 · low: watching the PR and CI')
  })
})
