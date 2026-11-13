import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AccountMembersLine } from './AccountMembersLine'
import { AccountsHostPicker } from './AccountsHostPicker'
import type { AccountsHostPickerRow } from './accounts-host-picker-rows'

vi.mock('react-native', () => ({
  Pressable: 'Pressable',
  StyleSheet: { create: <T,>(styles: T) => styles },
  Text: 'Text',
  View: 'View'
}))
vi.mock('lucide-react-native', () => ({ Check: 'Check', Monitor: 'Monitor', Users: 'Users' }))
vi.mock('../components/BottomDrawer', () => ({
  BottomDrawer: ({ children }: { children: unknown }) => children
}))

const rows: AccountsHostPickerRow[] = [
  { id: 'm1', name: 'm1', status: 'Connected · 2 Claude accounts', tone: 'green', current: true },
  { id: 'contabo', name: 'contabo', status: "Can't reach desktop", tone: 'red', current: false }
]

function textsOf(renderer: ReactTestRenderer): string[] {
  return renderer.root
    .findAllByType('Text')
    .flatMap((node) => node.children.filter((child) => typeof child === 'string'))
}

describe('AccountsHostPicker', () => {
  let renderer: ReactTestRenderer | null = null
  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
  })

  it('lists each host with its state, marks the open one, and opens the one picked', () => {
    const onPick = vi.fn()
    act(() => {
      renderer = create(
        createElement(AccountsHostPicker, { visible: true, rows, onPick, onClose: () => {} })
      )
    })

    expect(textsOf(renderer!)).toEqual([
      'Accounts on',
      'm1',
      'Connected · 2 Claude accounts',
      'contabo',
      "Can't reach desktop"
    ])
    expect(renderer!.root.findAllByType('Check')).toHaveLength(1)
    act(() => renderer!.root.findAllByType('Pressable')[1]!.props.onPress())
    expect(onPick).toHaveBeenCalledWith('contabo')
  })
})

describe('AccountMembersLine', () => {
  let renderer: ReactTestRenderer | null = null
  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
  })

  it('names who runs on the account, and draws nothing when nobody does', () => {
    act(() => {
      renderer = create(createElement(AccountMembersLine, { names: ['Lead', 'Merlín', 'Arquera'] }))
    })
    expect(textsOf(renderer!)).toEqual(['Lead, Merlín, Arquera'])

    act(() => renderer!.update(createElement(AccountMembersLine, { names: [] })))
    expect(renderer!.toJSON()).toBeNull()
  })
})
