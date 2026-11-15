import { createElement } from 'react'
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ActionSheetAction } from '../components/ActionSheetModal'
import { AgentTeamsSettingsBody } from './AgentTeamsSettingsBody'
import type { AgentTeamsSettingsState } from './use-agent-teams-settings'

vi.mock('react-native', () => ({
  ActivityIndicator: 'ActivityIndicator',
  Pressable: 'Pressable',
  StyleSheet: { create: <T,>(styles: T) => styles, hairlineWidth: 1 },
  TextInput: 'TextInput',
  View: 'View'
}))
vi.mock('../theme/dynamic-type-text', () => ({ Text: 'Text', TextInput: 'TextInput' }))
vi.mock('lucide-react-native', () => ({
  Check: 'Check',
  ChevronRight: 'ChevronRight',
  Image: 'Image',
  Palette: 'Palette'
}))
vi.mock('../components/BottomDrawer', () => ({
  BottomDrawer: ({ children, visible }: { children: unknown; visible: boolean }) =>
    visible ? children : null
}))
vi.mock('../components/ActionSheetModal', () => ({
  ActionSheetModal: (props: Record<string, unknown>) => createElement('ActionSheet', props)
}))

const READY: AgentTeamsSettingsState = {
  kind: 'ready',
  settings: { scene: 'quest', style: 'figures', dark: {} },
  saveError: null
}

describe('AgentTeamsSettingsBody', () => {
  const mounted: { renderer?: ReactTestRenderer } = {}
  afterEach(() => {
    act(() => mounted.renderer?.unmount())
    mounted.renderer = undefined
  })

  function render(state: AgentTeamsSettingsState) {
    const handlers = {
      onScene: vi.fn(),
      onStyle: vi.fn(),
      onToneColor: vi.fn(),
      onResetColors: vi.fn()
    }
    act(() => {
      mounted.renderer = create(
        createElement(AgentTeamsSettingsBody, { state, hostName: 'm1', ...handlers })
      )
    })
    return handlers
  }

  const root = () => mounted.renderer!.root
  const textOf = (node: ReactTestInstance): string => [node.props.children].flat().join('')
  const texts = () =>
    root()
      .findAllByType('Text' as never)
      .map(textOf)
  const pressable = (label: string) =>
    root()
      .findAllByType('Pressable' as never)
      .find((node) => node.findAllByType('Text' as never).some((text) => textOf(text) === label))!
  const sheet = (title: string) =>
    root()
      .findAllByType('ActionSheet' as never)
      .find((node) => node.props.title === title)!

  it('tells an older desktop to update instead of showing settings', () => {
    render({ kind: 'unsupported' })

    expect(texts()).toContain('Update Orca on m1 to use this')
    expect(texts()).not.toContain('Status colors')
  })

  it("shows the panel's scene and style, and the five roles with Reset held", () => {
    render(READY)

    expect(texts()).toEqual(
      expect.arrayContaining([
        'Panel',
        'Scene',
        'Quest',
        'Scene style',
        'Figures',
        'Status colors',
        'Needs you',
        'At risk',
        'Working',
        'Verified',
        'Idle'
      ])
    )
    expect(pressable('Reset').props.disabled).toBe(true)
  })

  it('picks a scene and a style from their sheets', () => {
    const { onScene, onStyle } = render(READY)

    act(() => pressable('Scene').props.onPress())
    const scenes = sheet('Scene')
    expect(scenes.props.visible).toBe(true)
    expect(scenes.props.actions.map((a: ActionSheetAction) => a.label)).toEqual([
      'Quest',
      'Night Watch',
      'Crystal Saga',
      'Beast Tamer',
      'Custom file…'
    ])
    expect(scenes.props.actions[4]).toMatchObject({ disabled: true })
    act(() => scenes.props.actions[1].onPress())
    expect(onScene).toHaveBeenCalledWith('vigilante')

    act(() => pressable('Scene style').props.onPress())
    act(() => sheet('Scene style').props.actions[1].onPress())
    expect(onStyle).toHaveBeenCalledWith('office')
  })

  it('names a custom scene file the desktop chose', () => {
    render({ ...READY, settings: { ...READY.settings, scene: '.orca/scenes/mario-bros.json' } })

    expect(texts()).toContain('mario-bros.json')
  })

  it('warns on a role too close to another, and Reset clears every edit', () => {
    const { onResetColors } = render({
      ...READY,
      settings: { ...READY.settings, dark: { info: '#30d095' } }
    })

    expect(texts()).toContain('Too close to Verified')
    const reset = pressable('Reset')
    expect(reset.props.disabled).toBe(false)
    act(() => reset.props.onPress())
    expect(onResetColors).toHaveBeenCalled()
  })

  it("opens a role's colour sheet from its swatch and saves the pick", () => {
    const { onToneColor } = render(READY)

    const swatch = root()
      .findAllByType('Pressable' as never)
      .find((node) => node.props.accessibilityLabel === 'Working colour')!
    act(() => swatch.props.onPress())
    expect(texts()).toContain('Working colour')
    const hue = root()
      .findAllByType('Pressable' as never)
      .find((node) => node.props.accessibilityLabel === '#e40014')!
    act(() => hue.props.onPress())

    expect(onToneColor).toHaveBeenCalledWith('info', '#e40014')
  })

  it('says when the desktop refused a save', () => {
    render({ ...READY, saveError: 'Could not save: Expected a #rrggbb colour' })

    expect(texts()).toContain('Could not save: Expected a #rrggbb colour')
  })
})
