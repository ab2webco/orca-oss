import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { describe, expect, it, vi } from 'vitest'

vi.mock('react-native', () => ({
  StyleSheet: { create: (styles: unknown) => styles },
  Text: 'Text',
  View: 'View'
}))

import { HomeStatsRow } from './HomeStatsRow'

function render(): ReactTestRenderer {
  let renderer!: ReactTestRenderer
  act(() => {
    renderer = create(
      createElement(HomeStatsRow, {
        stats: {
          totalAgentsSpawned: 22573,
          totalAgentTimeMs: (284 * 24 + 4) * 3_600_000,
          totalPRsCreated: 1265
        }
      })
    )
  })
  return renderer
}

function valueText(renderer: ReactTestRenderer, value: string) {
  return renderer.root.find(
    (node) => (node.type as unknown) === 'Text' && node.props.children === value
  )
}

describe('HomeStatsRow', () => {
  // Why: at 320 dp and the capped text size "22,573" broke inside the number as "22,57 / 3".
  it('shrinks the count values to one line instead of splitting a number', () => {
    const renderer = render()

    for (const value of [(22573).toLocaleString(), (1265).toLocaleString()]) {
      const text = valueText(renderer, value)
      expect(text.props.numberOfLines).toBe(1)
      expect(text.props.adjustsFontSizeToFit).toBe(true)
    }
  })

  it('lets the duration wrap at its space', () => {
    const text = valueText(render(), '284d 4h')

    expect(text.props.numberOfLines).toBeUndefined()
    expect(text.props.adjustsFontSizeToFit).toBeUndefined()
  })
})
