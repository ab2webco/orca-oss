import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { GameInboxList, type GameInboxListProps } from './GameInboxList'

vi.mock('react-native', () => ({
  ActivityIndicator: 'ActivityIndicator',
  Pressable: 'Pressable',
  RefreshControl: 'RefreshControl',
  ScrollView: 'ScrollView',
  StyleSheet: { create: (styles: unknown) => styles, hairlineWidth: 1 },
  Text: 'Text',
  TextInput: 'TextInput',
  View: 'View'
}))
vi.mock('../theme/dynamic-type-text', () => ({ Text: 'Text', TextInput: 'TextInput' }))

const question = (id: string, text: string) => ({
  id,
  ticket: null,
  question: text,
  options: [],
  context: null,
  askedAt: '2026-11-01T10:00:00.000Z',
  answer: null
})

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

async function render(overrides: Partial<GameInboxListProps>) {
  const props: GameInboxListProps = {
    connecting: false,
    state: { kind: 'loading' },
    refreshing: false,
    refreshError: null,
    now: Date.parse('2026-11-01T12:00:00.000Z'),
    bottomInset: 0,
    onRefresh: () => {},
    onAnswer: async () => {},
    onOpenLink: () => {},
    ...overrides
  }
  await act(async () => {
    renderers[renderers.length] = create(createElement(GameInboxList, props))
  })
}

const texts = (): string[] =>
  mounted()
    .root.findAllByType('Text' as never)
    .map((node) => [node.props.children].flat().join(''))

describe('GameInboxList', () => {
  it('groups questions under their project name', async () => {
    await render({
      state: {
        kind: 'ready',
        projects: [
          {
            repoId: 'r1',
            repoName: 'orca',
            worktreeId: 'w1',
            questions: [question('q1', 'First?')]
          },
          {
            repoId: 'r2',
            repoName: 'web',
            worktreeId: 'w2',
            questions: [question('q2', 'Second?')]
          }
        ]
      }
    })

    const shown = texts()
    expect(shown.indexOf('orca')).toBeLessThan(shown.indexOf('First?'))
    expect(shown.indexOf('web')).toBeLessThan(shown.indexOf('Second?'))
    expect(shown.indexOf('First?')).toBeLessThan(shown.indexOf('web'))
  })

  it('says nothing is waiting when every project is clear', async () => {
    await render({ state: { kind: 'ready', projects: [] } })

    expect(texts()).toContain('No questions are waiting for you.')
  })

  it('tells the person to update Orca on an older host instead of showing an empty list', async () => {
    await render({ state: { kind: 'unavailable' } })

    expect(texts()).toContain('The Inbox is unavailable on this host — update Orca on it.')
    expect(texts()).not.toContain('No questions are waiting for you.')
  })

  it('offers a retry after a failed read', async () => {
    const onRefresh = vi.fn()
    await render({ state: { kind: 'error', message: 'timeout' }, onRefresh })

    expect(texts()).toContain('Could not read the questions — timeout')
    const retry = mounted()
      .root.findAllByType('Pressable' as never)
      .find((node) => node.props.accessibilityLabel === 'Retry')!
    act(() => retry.props.onPress())
    expect(onRefresh).toHaveBeenCalled()
  })

  it('keeps the list and names a failed refresh above it', async () => {
    await render({
      state: {
        kind: 'ready',
        projects: [
          {
            repoId: 'r1',
            repoName: 'orca',
            worktreeId: 'w1',
            questions: [question('q1', 'First?')]
          }
        ]
      },
      refreshError: 'timeout'
    })

    expect(texts()).toEqual(expect.arrayContaining(['Could not refresh — timeout', 'First?']))
  })

  it('answers through the project worktree', async () => {
    const onAnswer = vi.fn(async () => {})
    await render({
      state: {
        kind: 'ready',
        projects: [
          {
            repoId: 'r1',
            repoName: 'orca',
            worktreeId: 'w1',
            questions: [{ ...question('q1', 'First?'), options: ['Yes'] }]
          }
        ]
      },
      onAnswer
    })

    const yes = mounted()
      .root.findAllByType('Pressable' as never)
      .find((node) => node.props.accessibilityLabel === 'Answer Yes')!
    await act(async () => yes.props.onPress())

    expect(onAnswer).toHaveBeenCalledWith('w1', 'q1', { option: 1 })
  })

  it('shows the connection before any read', async () => {
    await render({ connecting: true })

    expect(texts()).toContain('Connecting…')
  })
})
