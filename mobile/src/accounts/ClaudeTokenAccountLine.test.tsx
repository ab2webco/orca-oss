import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ClaudeAccountRowNotice, ClaudeTokenBadge } from './ClaudeTokenAccountLine'

vi.mock('react-native', () => ({
  StyleSheet: { create: <T,>(styles: T) => styles, hairlineWidth: 1 },
  View: 'View'
}))
vi.mock('../theme/dynamic-type-text', () => ({ Text: 'Text' }))
vi.mock('lucide-react-native', () => ({ KeyRound: 'KeyRound' }))

const TOKEN = {
  check: 'Token rejected — run claude setup-token again',
  tone: 'negative' as const,
  term: { expiry: 'Expires about Nov 15, 2027', saved: 'Saved Nov 15, 2026', soon: false }
}

describe('ClaudeAccountRowNotice', () => {
  const mounted: { renderer?: ReactTestRenderer } = {}
  afterEach(() => {
    act(() => mounted.renderer?.unmount())
    mounted.renderer = undefined
  })

  function texts(element: ReturnType<typeof createElement>): string[] {
    act(() => {
      mounted.renderer = create(element)
    })
    return mounted
      .renderer!.root.findAllByType('Text' as never)
      .map((node) => [node.props.children].flat().join(''))
  }

  it("shows a token account's check, term and saved date instead of the stored login's error", () => {
    const shown = texts(
      createElement(ClaudeAccountRowNotice, {
        token: TOKEN,
        usageError: 'Invalid authentication credentials'
      })
    )

    expect(shown).toEqual([
      'Token rejected — run claude setup-token again',
      'Expires about Nov 15, 2027 · Saved Nov 15, 2026'
    ])
  })

  it("keeps today's usage error for an account without a token", () => {
    expect(
      texts(
        createElement(ClaudeAccountRowNotice, { token: null, usageError: 'OAuth API returned 500' })
      )
    ).toEqual(['OAuth API returned 500'])
  })

  it('draws nothing for a plain account with no error', () => {
    expect(texts(createElement(ClaudeAccountRowNotice, { token: null, usageError: null }))).toEqual(
      []
    )
  })

  it("labels the token account with the desktop's badge", () => {
    expect(texts(createElement(ClaudeTokenBadge))).toEqual(['Token'])
  })
})
