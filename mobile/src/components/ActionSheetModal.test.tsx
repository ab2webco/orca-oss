import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ActionSheetModal } from './ActionSheetModal'

vi.mock('react-native', () => ({
  ActivityIndicator: 'ActivityIndicator',
  Pressable: 'Pressable',
  StyleSheet: { create: <T,>(styles: T) => styles, hairlineWidth: 1 },
  View: 'View'
}))
vi.mock('../theme/dynamic-type-text', () => ({ Text: 'Text' }))
vi.mock('lucide-react-native', () => ({ Edit3: 'Edit3', Trash2: 'Trash2' }))
vi.mock('./BottomDrawer', () => ({
  BottomDrawer: ({ children }: { children: unknown }) => children
}))

function textsOf(renderer: ReactTestRenderer): string[] {
  return renderer.root
    .findAllByType('Text')
    .flatMap((node) => node.children.filter((child) => typeof child === 'string'))
}

describe('ActionSheetModal sections', () => {
  const mounted: { renderer?: ReactTestRenderer } = {}
  afterEach(() => {
    act(() => mounted.renderer?.unmount())
    mounted.renderer = undefined
  })

  it('draws each titled section after the main actions, and closes on a section tap', () => {
    const onClose = vi.fn()
    const onGoToLead = vi.fn()
    act(() => {
      mounted.renderer = create(
        createElement(ActionSheetModal, {
          visible: true,
          title: 'New Tab',
          actions: [{ label: 'Terminal', onPress: () => {} }],
          sections: [
            {
              title: 'Team',
              actions: [{ label: 'Go to lead', hint: 'Lead on m1', onPress: onGoToLead }]
            }
          ],
          onClose
        })
      )
    })

    expect(textsOf(mounted.renderer!)).toEqual([
      'New Tab',
      'Terminal',
      'Team',
      'Go to lead',
      'Lead on m1'
    ])
    act(() => mounted.renderer!.root.findAllByType('Pressable')[1]!.props.onPress())
    expect(onGoToLead).toHaveBeenCalled()
    expect(onClose).toHaveBeenCalled()
  })
})
