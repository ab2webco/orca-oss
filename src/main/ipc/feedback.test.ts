import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  app: { getVersion: () => '1.4.160-lab.30' },
  ipcMain: { removeHandler: vi.fn(), handle: vi.fn() }
}))

vi.mock('node:os', () => ({ default: { release: () => '25.6.0' } }))

import { buildFeedbackIssueDraft } from './feedback'

function bodyOf(url: string): string {
  return decodeURIComponent(new URL(url).searchParams.get('body') ?? '')
}

function titleOf(url: string): string {
  return decodeURIComponent(new URL(url).searchParams.get('title') ?? '')
}

describe('buildFeedbackIssueDraft', () => {
  it('targets the fork issue tracker and never an upstream endpoint', () => {
    const draft = buildFeedbackIssueDraft('Terminals hang on resume')

    expect(draft.url.startsWith('https://github.com/ab2webco/orca-oss/issues/new?')).toBe(true)
    expect(draft.url).not.toContain('onorca.dev')
  })

  it('prefills the report and the build it came from', () => {
    const draft = buildFeedbackIssueDraft('  Terminals hang on resume  ')

    expect(draft.bodyInUrl).toBe(true)
    expect(titleOf(draft.url)).toBe('Terminals hang on resume')
    expect(bodyOf(draft.url)).toBe(draft.body)
    expect(draft.body).toContain('Terminals hang on resume')
    expect(draft.body).toContain('Orca 1.4.160-lab.30 ·')
    expect(draft.body).toContain('25.6.0')
  })

  it('titles from the first line only, capped', () => {
    const draft = buildFeedbackIssueDraft(`${'t'.repeat(200)}\nmore detail`)

    expect(titleOf(draft.url)).toHaveLength(80)
    expect(titleOf(draft.url).endsWith('…')).toBe(true)
    expect(draft.body).toContain('more detail')
  })

  it('keeps a long report out of the URL so it can travel by clipboard', () => {
    const draft = buildFeedbackIssueDraft('x'.repeat(8000))

    expect(draft.bodyInUrl).toBe(false)
    expect(new URL(draft.url).searchParams.get('body')).toBeNull()
    expect(draft.body).toContain('x'.repeat(8000))
  })

  it('skips leading blank lines when titling', () => {
    const draft = buildFeedbackIssueDraft('\n\nonly a later line')

    expect(titleOf(draft.url)).toBe('only a later line')
  })

  it('falls back to a generic title when the report is blank', () => {
    expect(titleOf(buildFeedbackIssueDraft('   ').url)).toBe('Orca feedback')
  })
})
