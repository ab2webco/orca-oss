// @vitest-environment happy-dom

import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { GameOwnerQuestion } from '../../../../shared/orchestrator-game-owner-questions'
import type { GameInboxThreads } from '../../../../shared/orchestrator-game-inbox-threads'
import type { GameInboxQuestionGroup } from '@/components/game-inbox/GameInboxSheet'
import { TeamInboxView } from './team-panel-inbox-tab'

vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: () => ({
    getTotalSize: () => 0,
    getVirtualItems: () => [],
    measureElement: vi.fn(),
    scrollToIndex: vi.fn()
  })
}))

afterEach(cleanup)

const AT = '2026-11-06T10:00:00.000Z'

const question = (id: string, text: string, ticket: string | null): GameOwnerQuestion => ({
  id,
  ticket,
  question: text,
  options: ['Merge now', 'Wait for #915'],
  context: null,
  askedAt: AT,
  answer: null
})

const THREADS: GameInboxThreads = {
  threads: [
    {
      ticket: 'ORCA-1039',
      last: AT,
      waiting: 0,
      messages: [
        {
          id: 'm1',
          at: AT,
          from: 'ORCA-1039',
          to: 'lead',
          kind: 'status',
          subject: 'Approach approved',
          body: '',
          failure: null
        }
      ]
    }
  ],
  waiting: [
    {
      id: 'w1',
      ticket: 'ORCA-1033',
      kind: 'question',
      subject: 'Rebase?',
      body: 'Rebase #917 now or wait for #913?',
      at: AT,
      answerer: 'lead'
    }
  ],
  answered: [
    {
      id: 'a1',
      ticket: 'ORCA-1011',
      kind: 'question',
      question: 'Include #911 in lab.115?',
      answer: 'Yes, include it',
      askedAt: AT,
      answeredAt: AT
    }
  ]
}

function renderInbox(
  over: Partial<React.ComponentProps<typeof TeamInboxView>> = {}
): ReturnType<typeof render> {
  const other: GameInboxQuestionGroup = {
    key: 'env-imac\u0000repo-web',
    title: 'Ab2Web',
    host: 'imac',
    questions: [question('q-web', 'Ship the price change today?', 'WEB-212')],
    onAnswer: vi.fn(async () => {})
  }
  return render(
    <TeamInboxView
      projectName="orca-oss"
      projectUnread={null}
      questions={[question('q-1', 'Merge #923 now or wait for #915?', 'ORCA-1039')]}
      onAnswer={vi.fn(async () => {})}
      otherGroups={[other]}
      threads={THREADS}
      onReply={vi.fn(async () => {})}
      {...over}
    />
  )
}

const pick = (view: ReturnType<typeof render>, name: RegExp): void => {
  const trigger = view.getByRole('tab', { name })
  act(() => {
    fireEvent.mouseDown(trigger)
    fireEvent.click(trigger)
  })
}

describe('Inbox tab', () => {
  it('opens on For you with this project and every other project and host', () => {
    const view = renderInbox()

    expect(view.getByRole('tab', { name: /For you/ }).getAttribute('data-state')).toBe('active')
    expect(view.getByRole('tab', { name: /For you/ }).textContent).toContain('2')
    expect(view.getByText('orca-oss · this project')).toBeTruthy()
    expect(view.getByText('Merge #923 now or wait for #915?')).toBeTruthy()
    expect(view.getByText('Ab2Web · imac')).toBeTruthy()
    expect(view.getByText('Ship the price change today?')).toBeTruthy()
  })

  it('answers a question through its own project', async () => {
    const onAnswer = vi.fn(async () => {})
    const view = renderInbox({ onAnswer })

    const card = view.container.querySelector('[data-game-owner-question="q-1"]')
    const option = card?.querySelector('button')
    await act(async () => fireEvent.click(option as HTMLButtonElement))

    expect(onAnswer).toHaveBeenCalledWith('q-1', { option: 1 })
  })

  // Why: a failed read of this project must not pass for "nothing asked here".
  it('says when this project could not be read while others show', () => {
    const view = renderInbox({ questions: [], projectUnread: { message: 'Host offline' } })

    expect(view.getByText(/Could not read this project's questions/)).toBeTruthy()
    expect(view.getByText('Host offline')).toBeTruthy()
    expect(view.getByText('Ship the price change today?')).toBeTruthy()
  })

  it('counts and lists Waiting, Threads and Answered', () => {
    const view = renderInbox()

    expect(view.getByRole('tab', { name: /Waiting/ }).textContent).toContain('1')
    expect(view.getByRole('tab', { name: /Threads/ }).textContent).toContain('1')
    expect(view.getByRole('tab', { name: /Answered/ }).textContent).toContain('1')

    pick(view, /Waiting/)
    expect(view.getByText('Rebase #917 now or wait for #913?')).toBeTruthy()
    expect(view.getByPlaceholderText('Answer instead of the lead')).toBeTruthy()

    pick(view, /Threads/)
    expect(view.getByTestId('game-inbox-thread-ORCA-1039')).toBeTruthy()

    pick(view, /Answered/)
    expect(view.getByText('Include #911 in lab.115?')).toBeTruthy()
  })

  // Why: the model counts the lead's own inbox as a thread, so the shell may not draw empty itself.
  it('draws the empty state when every list is empty', () => {
    const view = renderInbox({
      questions: [],
      otherGroups: [],
      threads: { threads: [], waiting: [], answered: [] }
    })

    expect(view.getByText('Nothing waits for you')).toBeTruthy()
    expect(view.queryByRole('tab', { name: /For you/ })).toBeNull()
  })

  it('says nothing waits when For you is empty', () => {
    const view = renderInbox({ questions: [], otherGroups: [] })

    expect(view.getByText('No questions are waiting for you.')).toBeTruthy()
  })
})
