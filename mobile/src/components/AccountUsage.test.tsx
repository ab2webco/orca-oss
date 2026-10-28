import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { describe, expect, it, vi } from 'vitest'

vi.mock('react-native', () => ({
  ActivityIndicator: 'ActivityIndicator',
  StyleSheet: { create: (styles: unknown) => styles },
  Text: 'Text',
  View: 'View'
}))

import { UsageBar } from './AccountUsage'

describe('UsageBar', () => {
  // Why: at 320 dp and the capped text size, "100%" split into "100 / %" in its fixed column.
  it('shrinks the percentage to one line instead of splitting it', () => {
    let renderer!: ReactTestRenderer
    act(() => {
      renderer = create(
        createElement(UsageBar, { label: '5h', usedPercent: 100, unavailable: false })
      )
    })

    const value = renderer.root.find(
      (node) => (node.type as unknown) === 'Text' && node.props.children === '100%'
    )
    expect(value.props.numberOfLines).toBe(1)
    expect(value.props.adjustsFontSizeToFit).toBe(true)
  })
})
