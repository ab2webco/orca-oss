import { createElement } from 'react'
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { StatusColorSheet } from './StatusColorSheet'

vi.mock('react-native', () => ({
  Pressable: 'Pressable',
  StyleSheet: { create: <T,>(styles: T) => styles },
  TextInput: 'TextInput',
  View: 'View'
}))
vi.mock('../theme/dynamic-type-text', () => ({ Text: 'Text', TextInput: 'TextInput' }))
vi.mock('../components/BottomDrawer', () => ({
  BottomDrawer: ({ children, visible }: { children: unknown; visible: boolean }) =>
    visible ? children : null
}))

const ROW = {
  tone: 'info' as const,
  name: 'Working',
  color: '#4fc3f7',
  edited: false,
  warning: null
}

describe('StatusColorSheet', () => {
  const mounted: { renderer?: ReactTestRenderer } = {}
  afterEach(() => {
    act(() => mounted.renderer?.unmount())
    mounted.renderer = undefined
  })

  function render(row = ROW) {
    const onPick = vi.fn()
    const onClose = vi.fn()
    act(() => {
      mounted.renderer = create(createElement(StatusColorSheet, { row, onPick, onClose }))
    })
    return { onPick, onClose }
  }
  const textOf = (node: ReactTestInstance): string => [node.props.children].flat().join('')
  const button = (label: string) =>
    mounted
      .renderer!.root.findAllByType('Pressable' as never)
      .find((node) => node.findAllByType('Text' as never).some((text) => textOf(text) === label))!
  const input = () => mounted.renderer!.root.findByType('TextInput' as never)

  it('takes a typed #rrggbb only once it is valid', () => {
    const { onPick, onClose } = render()

    act(() => input().props.onChangeText('#12345'))
    expect(button('Use').props.disabled).toBe(true)
    expect(mounted.renderer!.root.findAllByType('Text' as never).map(textOf)).toContain(
      'Use #rrggbb'
    )

    act(() => input().props.onChangeText('#12AB56'))
    act(() => button('Use').props.onPress())
    expect(onPick).toHaveBeenCalledWith('#12AB56')
    expect(onClose).toHaveBeenCalled()
  })

  it('puts an edited role back on its default, and holds Default otherwise', () => {
    render()
    expect(button('Default').props.disabled).toBe(true)

    const { onPick } = render({ ...ROW, edited: true, color: '#123456' })
    act(() => button('Default').props.onPress())
    expect(onPick).toHaveBeenCalledWith(null)
  })
})
