import { createElement } from 'react'
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AddMemberSheet } from './AddMemberSheet'
import type { AddMemberRoster } from './add-member-options'

vi.mock('react-native', () => ({
  Pressable: 'Pressable',
  ScrollView: 'ScrollView',
  StyleSheet: { create: <T,>(styles: T) => styles, hairlineWidth: 1 },
  View: 'View'
}))
vi.mock('../theme/dynamic-type-text', () => ({ Text: 'Text' }))
vi.mock('lucide-react-native', () => ({
  Check: 'Check',
  ChevronDown: 'ChevronDown',
  Monitor: 'Monitor'
}))
vi.mock('../components/BottomDrawer', () => ({
  BottomDrawer: ({ children }: { children: unknown }) => children
}))

const roster: AddMemberRoster = {
  todo: [
    { identifier: 'ACME-221', title: 'Retry policy for payments', prompt: 'p221' },
    { identifier: 'ACME-222', title: 'Checkout copy review', prompt: 'p222' }
  ],
  hosts: [
    { on: null, running: 2, cap: 5 },
    { on: 'imac', running: 0, cap: null }
  ]
}
function textsOf(node: ReactTestInstance): string[] {
  return node
    .findAllByType('Text')
    .flatMap((one) => one.children.filter((child) => typeof child === 'string'))
}

function pressableWith(renderer: ReactTestRenderer, text: string): ReactTestInstance {
  const found = renderer.root
    .findAllByType('Pressable')
    .find((node) => textsOf(node).includes(text))
  if (!found) {
    throw new Error(`no pressable with ${text}`)
  }
  return found
}

describe('AddMemberSheet', () => {
  const mounted: { renderer?: ReactTestRenderer } = {}
  afterEach(() => {
    act(() => mounted.renderer?.unmount())
    mounted.renderer = undefined
  })

  function render(onSend = vi.fn()) {
    act(() => {
      mounted.renderer = create(
        createElement(AddMemberSheet, {
          visible: true,
          hostName: 'm1',
          roster,
          onSend,
          onClose: () => {}
        })
      )
    })
    return { renderer: mounted.renderer!, onSend }
  }

  it("shows the lead's desktop with its agents, and the To Do", () => {
    const { renderer } = render()

    expect(textsOf(renderer.root)).toEqual([
      'Add member',
      'Run on',
      'm1',
      '2 of 5 agents',
      'To Do',
      'ACME-221',
      'Retry policy for payments',
      'ACME-222',
      'Checkout copy review',
      'Add member'
    ])
  })

  it('sends nothing until one ticket is picked, then sends that one', () => {
    const { renderer, onSend } = render()
    const button = () => renderer.root.findAllByType('Pressable').at(-1)!

    expect(button().props.disabled).toBe(true)
    act(() => pressableWith(renderer, 'ACME-221').props.onPress())
    act(() => pressableWith(renderer, 'ACME-222').props.onPress())
    expect(pressableWith(renderer, 'ACME-222').props.accessibilityState).toEqual({ selected: true })
    expect(pressableWith(renderer, 'ACME-221').props.accessibilityState).toEqual({
      selected: false
    })
    act(() => button().props.onPress())

    expect(onSend).toHaveBeenCalledWith({ ticket: roster.todo[1], accountId: null, on: null })
  })

  // Why: a background step alone (#242424 on #1a1a1a) read as unpicked in the m1 captures.
  it('marks the picked ticket with a check and a bold title, and no other row', () => {
    const { renderer } = render()
    const checksIn = (text: string) => pressableWith(renderer, text).findAllByType('Check').length
    const titleWeight = (text: string) =>
      [pressableWith(renderer, text).findAllByType('Text')[1].props.style]
        .flat(2)
        .find((style) => style?.fontWeight)?.fontWeight

    expect(checksIn('ACME-221')).toBe(0)
    act(() => pressableWith(renderer, 'ACME-221').props.onPress())

    expect(checksIn('ACME-221')).toBe(1)
    expect(checksIn('ACME-222')).toBe(0)
    expect(titleWeight('ACME-221')).toBe('600')
    expect(titleWeight('ACME-222')).toBeUndefined()
  })

  it('marks the host the member runs on in the open Run on list', () => {
    const { renderer } = render()
    const optionChecks = () =>
      renderer.root
        .findAllByType('Pressable')
        .filter((node) => textsOf(node).includes('imac') || textsOf(node).includes('m1'))
        .slice(1)
        .map((node) => [textsOf(node)[0], node.findAllByType('Check').length])

    act(() => pressableWith(renderer, 'm1').props.onPress())
    expect(optionChecks()).toEqual([
      ['m1', 1],
      ['imac', 0]
    ])
    act(() => pressableWith(renderer, 'imac').props.onPress())
    act(() => pressableWith(renderer, 'imac').props.onPress())
    expect(optionChecks()).toEqual([
      ['m1', 0],
      ['imac', 1]
    ])
  })

  it('runs the member on another host when picked', () => {
    const { renderer, onSend } = render()

    act(() => pressableWith(renderer, 'm1').props.onPress())
    act(() => pressableWith(renderer, 'imac').props.onPress())
    act(() => pressableWith(renderer, 'ACME-221').props.onPress())
    act(() => renderer.root.findAllByType('Pressable').at(-1)!.props.onPress())

    expect(onSend).toHaveBeenCalledWith({ ticket: roster.todo[0], accountId: null, on: 'imac' })
    expect(textsOf(renderer.root)).toContain('0 agents')
  })

  it('opens again with no ticket picked', () => {
    const { renderer } = render()
    const props = { hostName: 'm1', roster, onSend: vi.fn(), onClose: () => {} }
    act(() => pressableWith(renderer, 'ACME-221').props.onPress())

    act(() => renderer.update(createElement(AddMemberSheet, { ...props, visible: false })))
    act(() => renderer.update(createElement(AddMemberSheet, { ...props, visible: true })))

    expect(renderer.root.findAllByType('Pressable').at(-1)!.props.disabled).toBe(true)
  })
})
