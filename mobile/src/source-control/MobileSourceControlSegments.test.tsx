import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { describe, expect, it, vi } from 'vitest'

vi.mock('react-native', () => ({
  Pressable: 'Pressable',
  StyleSheet: { create: (styles: unknown) => styles },
  Text: 'Text',
  View: 'View'
}))

import { MobileSourceControlSegments } from './MobileSourceControlSegments'

describe('MobileSourceControlSegments', () => {
  // Why: at 320 dp and the capped text size the middle tab truncated to "Pull Requ…".
  it('shrinks a tab label to fit its segment instead of truncating it', () => {
    let renderer!: ReactTestRenderer
    act(() => {
      renderer = create(
        createElement(MobileSourceControlSegments, { active: 'changes', onSelect: vi.fn() })
      )
    })

    const labels = renderer.root.findAll((node) => (node.type as unknown) === 'Text')
    expect(labels.length).toBeGreaterThan(1)
    for (const label of labels) {
      expect(label.props.numberOfLines).toBe(1)
      expect(label.props.adjustsFontSizeToFit).toBe(true)
    }
  })
})
