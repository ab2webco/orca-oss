import { createElement } from 'react'
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { describe, expect, it, vi } from 'vitest'

vi.mock('react-native', () => ({
  Pressable: 'Pressable',
  StyleSheet: { create: <T,>(styles: T) => styles, hairlineWidth: 1 },
  Text: 'Text',
  TextInput: 'TextInput',
  View: 'View'
}))
vi.mock('../components/BottomDrawer', () => import('../../test-doubles/bottom-drawer-test-double'))

import { PlaneBoardCreateDrawer } from './plane-board-create-drawer'

type DrawerProps = Parameters<typeof PlaneBoardCreateDrawer>[0]

function mount(overrides: Partial<DrawerProps> = {}) {
  const props: DrawerProps = {
    visible: true,
    columnName: 'In Progress',
    pending: false,
    error: null,
    onSubmit: vi.fn(async () => true),
    onClose: vi.fn(),
    ...overrides
  }
  let renderer!: ReactTestRenderer
  act(() => {
    renderer = create(createElement(PlaneBoardCreateDrawer, props))
  })
  const update = (next: Partial<DrawerProps>): void => {
    Object.assign(props, next)
    act(() => {
      renderer.update(createElement(PlaneBoardCreateDrawer, { ...props }))
    })
  }
  return { renderer, props, update }
}

function textOf(renderer: ReactTestRenderer): string {
  return renderer.root
    .findAllByType('Text')
    .map((node) => node.children.filter((child) => typeof child === 'string').join(''))
    .join('\n')
}

function titleInput(renderer: ReactTestRenderer): ReactTestInstance {
  return renderer.root.findByType('TextInput')
}

function createButton(renderer: ReactTestRenderer): ReactTestInstance {
  return renderer.root
    .findAllByType('Pressable')
    .find((node) => node.props.accessibilityLabel === 'Create card')!
}

function typeTitle(renderer: ReactTestRenderer, value: string): void {
  act(() => {
    titleInput(renderer).props.onChangeText(value)
  })
}

describe('PlaneBoardCreateDrawer', () => {
  it('renders nothing while hidden', () => {
    const { renderer } = mount({ visible: false })
    expect(renderer.root.findAllByType('TextInput')).toEqual([])
  })

  it('names the column the card will land in and focuses the title', () => {
    const { renderer } = mount()
    expect(textOf(renderer)).toContain('In Progress')
    expect(titleInput(renderer).props.autoFocus).toBe(true)
  })

  it('submits the trimmed title, then clears the draft and closes', async () => {
    const { renderer, props } = mount()
    expect(createButton(renderer).props.disabled).toBe(true)

    typeTitle(renderer, '  Ship the drawer  ')
    expect(createButton(renderer).props.disabled).toBe(false)
    await act(async () => {
      await createButton(renderer).props.onPress()
    })

    expect(props.onSubmit).toHaveBeenCalledWith('Ship the drawer')
    expect(props.onClose).toHaveBeenCalledTimes(1)
    expect(titleInput(renderer).props.value).toBe('')
  })

  it('keeps the draft open when the host refuses the create', async () => {
    const { renderer, props, update } = mount({ onSubmit: vi.fn(async () => false) })
    typeTitle(renderer, 'Ship the drawer')
    await act(async () => {
      await createButton(renderer).props.onPress()
    })
    update({ error: 'Title is required' })

    expect(props.onClose).not.toHaveBeenCalled()
    expect(titleInput(renderer).props.value).toBe('Ship the drawer')
    expect(textOf(renderer)).toContain('Title is required')
    // The same button is the retry: enabled, and labelled as one.
    expect(createButton(renderer).props.disabled).toBe(false)
    expect(textOf(renderer)).toContain('Try again')
  })

  it('blocks a second submit while the first is in flight', () => {
    const { renderer } = mount({ pending: true })
    typeTitle(renderer, 'Ship the drawer')
    expect(createButton(renderer).props.disabled).toBe(true)
    expect(textOf(renderer)).toContain('Creating…')
  })
})
