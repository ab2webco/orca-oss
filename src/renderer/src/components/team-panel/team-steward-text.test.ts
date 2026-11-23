import { describe, expect, it, vi } from 'vitest'
import {
  teamStewardCacheText,
  teamStewardMomentText,
  teamStewardVisitText
} from './team-steward-text'

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

// ORCA-1350: whether the member's prompt cache was warm, and why the steward kept or moved the model.
describe('teamStewardCacheText', () => {
  const cache = {
    at: 1,
    warm: true,
    known: true,
    ttl: '1h' as const,
    contextTokens: 120_400,
    why: 'warm-hold'
  }

  it('says warm or cold, the TTL, the context and why the model stayed or moved', () => {
    expect(teamStewardCacheText(cache, '09:20 PM')).toBe(
      '09:20 PM the cache was warm · 1 h · 120k tokens: kept the model, moved only effort'
    )
    expect(
      teamStewardCacheText({ ...cache, warm: false, ttl: '5m', why: 'cold' }, '09:20 PM')
    ).toBe(
      '09:20 PM the cache was cold · 5 min · 120k tokens: the cache was cold, so the model switched'
    )
    expect(teamStewardCacheText({ ...cache, why: 'pays-back' }, '09:20 PM')).toBe(
      '09:20 PM the cache was warm · 1 h · 120k tokens: the switch pays for its cache rewrite'
    )
  })

  it('says when it has not read the cache yet, which counts as warm', () => {
    expect(teamStewardCacheText({ ...cache, known: false, why: 'effort-only' }, '09:20 PM')).toBe(
      '09:20 PM the cache was not read yet, counted warm: only the effort changed'
    )
  })

  it('names the moments a held switch lands on', () => {
    expect(teamStewardMomentText('cold')).toBe('the cache went cold')
    expect(teamStewardMomentText('compacted')).toBe('a compaction rewrote the history')
  })
})
