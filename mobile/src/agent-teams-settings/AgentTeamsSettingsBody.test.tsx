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
  settings: { scene: 'quest', style: 'figures' },
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
      onStyle: vi.fn()
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
    expect(texts()).not.toContain('Panel')
  })

  it("shows the panel's scene and style", () => {
    render(READY)

    expect(texts()).toEqual(
      expect.arrayContaining(['Panel', 'Scene', 'Quest', 'Scene style', 'Figures'])
    )
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

  it('says when the desktop refused a save', () => {
    render({ ...READY, saveError: 'Could not save: Invalid enum value' })

    expect(texts()).toContain('Could not save: Invalid enum value')
  })
})
