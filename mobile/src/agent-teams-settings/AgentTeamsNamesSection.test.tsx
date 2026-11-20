import { createElement } from 'react'
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { agentTeamsNamesOf } from '../../../src/shared/agent-teams-names-settings'
import { AgentTeamsNamesSection } from './AgentTeamsNamesSection'
import type { AgentTeamsNamesState } from './use-agent-teams-names'

vi.mock('react-native', () => ({
  Pressable: 'Pressable',
  StyleSheet: { create: <T,>(styles: T) => styles, hairlineWidth: 1 },
  View: 'View'
}))
vi.mock('../theme/dynamic-type-text', () => ({ Text: 'Text', TextInput: 'TextInput' }))
vi.mock('lucide-react-native', () => ({
  ChevronRight: 'ChevronRight',
  Crown: 'Crown',
  Users: 'Users'
}))
vi.mock('../components/TextInputModal', () => ({
  TextInputModal: (props: Record<string, unknown>) => createElement('TextInputModal', props)
}))

const readyWith = (orchestrator?: { label?: string; memberNames?: string[] }, scene = 'quest') =>
  ({
    kind: 'ready',
    names: agentTeamsNamesOf({ orchestratorGame: { scene, orchestrator } }),
    saveError: null
  }) as AgentTeamsNamesState

describe('AgentTeamsNamesSection', () => {
  const mounted: { renderer?: ReactTestRenderer } = {}
  afterEach(() => {
    act(() => mounted.renderer?.unmount())
    mounted.renderer = undefined
  })

  function render(state: AgentTeamsNamesState) {
    const onLeadName = vi.fn()
    const onMemberNames = vi.fn()
    act(() => {
      mounted.renderer = create(
        createElement(AgentTeamsNamesSection, { state, hostName: 'Mac', onLeadName, onMemberNames })
      )
    })
    const root = mounted.renderer!.root
    const text = () =>
      root
        .findAllByType('Text' as never)
        .map((node: ReactTestInstance) => [node.props.children].flat().join(''))
        .join('\n')
    const modal = (title: string) =>
      root.findAll(
        (node) => (node.type as unknown) === 'TextInputModal' && node.props.title === title
      )[0]!
    const press = (label: string) =>
      act(() =>
        root
          .findAll((node) => node.props.accessibilityLabel === label && !!node.props.onPress)[0]!
          .props.onPress()
      )
    return { text, modal, press, onLeadName, onMemberNames }
  }

  it('says where names come from: an unnamed lead is Lead, members take the scene roster', () => {
    const { text } = render(readyWith(undefined, 'vigilante'))

    expect(text()).toContain('Lead, until you name it · default')
    expect(text()).toContain('Nightjar')
    expect(text()).toContain('From the scene')
  })

  it("shows this computer's names with their layer", () => {
    const { text } = render(readyWith({ label: 'Ada', memberNames: ['Bo', 'Cy'] }))

    expect(text()).toContain('Ada')
    expect(text()).toContain('Every project without its own · this computer')
    expect(text()).toContain('Bo, Cy')
    expect(text()).toContain('Your list · this computer')
  })

  it('names the lead, and an empty name clears it back to Lead', () => {
    const { modal, press, onLeadName } = render(readyWith())

    press('Lead name')
    expect(modal('Lead name').props.visible).toBe(true)
    act(() => modal('Lead name').props.onSubmit('Ada'))
    press('Lead name')
    act(() => modal('Lead name').props.onSubmit(''))

    expect(onLeadName.mock.calls).toEqual([['Ada'], [null]])
  })

  it('sets the member names from a comma list, and empty means the scene names', () => {
    const { modal, press, onMemberNames } = render(readyWith())

    press('Member names')
    act(() => modal('Member names').props.onSubmit('Bo, Cy,, '))
    press('Member names')
    act(() => modal('Member names').props.onSubmit(''))

    expect(onMemberNames.mock.calls).toEqual([[['Bo', 'Cy']], [null]])
  })

  it('asks for an update on an older host under the Names heading', () => {
    const { text } = render({ kind: 'unsupported' })

    expect(text()).toBe('Names\nUpdate Orca on Mac to name the team here')
  })

  it('has no roster to show for a scene file, which only the desktop reads', () => {
    const { text } = render(readyWith(undefined, '/scenes/mine.json'))

    expect(text()).toContain('From the scene file · set them on the desktop')
  })
})
