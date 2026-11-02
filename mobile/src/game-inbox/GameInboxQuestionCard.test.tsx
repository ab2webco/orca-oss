import { createElement } from 'react'
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { GameOwnerQuestion } from '../../../src/shared/orchestrator-game-owner-questions'
import { GameInboxQuestionCard } from './GameInboxQuestionCard'

vi.mock('react-native', () => ({
  ActivityIndicator: 'ActivityIndicator',
  Pressable: 'Pressable',
  StyleSheet: { create: (styles: unknown) => styles, hairlineWidth: 1 },
  Text: 'Text',
  TextInput: 'TextInput',
  View: 'View'
}))
vi.mock('../theme/dynamic-type-text', () => ({ Text: 'Text', TextInput: 'TextInput' }))

const NOW = Date.parse('2026-11-01T12:00:00.000Z')
const question: GameOwnerQuestion = {
  id: 'q1',
  ticket: 'ORCA-940',
  question: 'Ship the phone Inbox now?',
  options: ['Yes', 'Wait'],
  context: 'https://github.com/o/r/pull/1',
  askedAt: '2026-11-01T10:00:00.000Z',
  answer: null
}

// Why a list: the root's type-aware lint cannot resolve this type, so a `| null` union reads as any.
const renderers: ReactTestRenderer[] = []
const mounted = (): ReactTestRenderer => renderers.at(-1)!

afterEach(() => {
  act(() => {
    for (const renderer of renderers.splice(0)) {
      renderer.unmount()
    }
  })
})

async function render(props: {
  worktreeId?: string | null
  onAnswer?: (reply: { option: number } | { text: string }) => Promise<void>
  onOpenLink?: (url: string) => void
  q?: GameOwnerQuestion
}) {
  await act(async () => {
    renderers[renderers.length] = create(
      createElement(GameInboxQuestionCard, {
        question: props.q ?? question,
        worktreeId: props.worktreeId === undefined ? 'w1' : props.worktreeId,
        now: NOW,
        onAnswer: props.onAnswer ?? (async () => {}),
        onOpenLink: props.onOpenLink ?? (() => {})
      })
    )
  })
}

const texts = (): string[] =>
  mounted()
    .root.findAllByType('Text' as never)
    .map((node) => [node.props.children].flat().join(''))

const button = (label: string): ReactTestInstance =>
  mounted()
    .root.findAllByType('Pressable' as never)
    .find((node) => node.props.accessibilityLabel === label)!

describe('GameInboxQuestionCard', () => {
  it('shows the ticket, the age, the question and each option', async () => {
    await render({})

    expect(texts()).toEqual(
      expect.arrayContaining(['ORCA-940', '2h', 'Ship the phone Inbox now?', 'Yes', 'Wait'])
    )
  })

  it('answers with the 1-based number of the picked option', async () => {
    const onAnswer = vi.fn(async () => {})
    await render({ onAnswer })

    await act(async () => button('Answer Wait').props.onPress())

    expect(onAnswer).toHaveBeenCalledWith({ option: 2 })
  })

  it('sends a typed answer and clears the field once the host took it', async () => {
    const onAnswer = vi.fn(async () => {})
    await render({ onAnswer })
    const input = mounted().root.findByType('TextInput' as never)

    await act(async () => input.props.onChangeText('After the e2e run'))
    await act(async () => button('Send answer').props.onPress())

    expect(onAnswer).toHaveBeenCalledWith({ text: 'After the e2e run' })
    expect(mounted().root.findByType('TextInput' as never).props.value).toBe('')
  })

  it('keeps Send disabled while the typed answer is blank', async () => {
    await render({})

    expect(button('Send answer').props.disabled).toBe(true)
  })

  it('shows the host refusal and keeps the typed answer', async () => {
    await render({
      onAnswer: async () => {
        throw new Error('Question q1 is already answered: Yes')
      }
    })
    await act(async () =>
      mounted()
        .root.findByType('TextInput' as never)
        .props.onChangeText('No')
    )

    await act(async () => button('Send answer').props.onPress())

    expect(texts()).toContain('Question q1 is already answered: Yes')
    expect(mounted().root.findByType('TextInput' as never).props.value).toBe('No')
  })

  it('opens an http(s) context externally', async () => {
    const onOpenLink = vi.fn()
    await render({ onOpenLink })

    await act(async () => button('Open https://github.com/o/r/pull/1').props.onPress())

    expect(onOpenLink).toHaveBeenCalledWith('https://github.com/o/r/pull/1')
  })

  it('shows a context that is not a link as plain text', async () => {
    await render({ q: { ...question, context: 'See the lead chat' } })

    expect(texts()).toContain('See the lead chat')
    expect(button('Open See the lead chat')).toBeUndefined()
  })

  it('disables answering for a project the phone has no worktree to answer through', async () => {
    await render({ worktreeId: null })

    expect(button('Answer Yes').props.disabled).toBe(true)
    expect(mounted().root.findAllByType('TextInput' as never)).toHaveLength(0)
    expect(texts()).toContain('Answer this one from Orca on the desktop.')
  })
})
