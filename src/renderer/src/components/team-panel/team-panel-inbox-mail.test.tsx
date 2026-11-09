// @vitest-environment happy-dom

import { act, cleanup, fireEvent, render, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { GameInboxThreads } from '../../../../shared/orchestrator-game-inbox-threads'
import type { GameOwnerQuestion } from '../../../../shared/orchestrator-game-owner-questions'
import type { GameMemberReply } from '@/components/game-inbox/game-inbox-threads-client'
import { TeamInboxView } from './team-panel-inbox-tab'

// Moved from GameInboxSheet.test.tsx when the Inbox tab replaced the Sheet (ORCA-1072).

vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: ({ count }: { count: number }) => ({
    getTotalSize: () => count * 80,
    getVirtualItems: () =>
      Array.from({ length: count }, (_, index) => ({
        index,
        key: index,
        start: index * 80,
        size: 80,
        end: (index + 1) * 80,
        lane: 0
      })),
    measureElement: vi.fn(),
    scrollToIndex: vi.fn()
  })
}))

const AN_HOUR_AGO = new Date(Date.now() - 60 * 60 * 1000).toISOString()

const THREADS: GameInboxThreads = {
  threads: [
    {
      ticket: 'ORCA-12',
      last: AN_HOUR_AGO,
      waiting: 1,
      messages: [
        {
          id: 'm1',
          at: AN_HOUR_AGO,
          from: 'lead',
          to: 'ORCA-12',
          kind: 'dispatch',
          subject: 'Work on ORCA-12',
          body: 'Read your brief.',
          failure: null
        },
        {
          id: 'm2',
          at: AN_HOUR_AGO,
          from: 'ORCA-12',
          to: 'lead',
          kind: 'worker_done',
          subject: 'Rejected worker_done: done',
          body: 'Orca Lab rejected this worker_done',
          failure: { kind: 'rejected', reason: 'summary is empty' }
        }
      ]
    },
    { ticket: 'ORCA-14', last: AN_HOUR_AGO, waiting: 0, messages: [] }
  ],
  waiting: [
    {
      id: 'q1',
      ticket: 'ORCA-12',
      kind: 'question',
      subject: 'Question',
      body: 'Which port?',
      at: AN_HOUR_AGO,
      answerer: 'lead'
    }
  ],
  answered: [
    {
      id: 'q0',
      ticket: 'ORCA-14',
      kind: 'decision_gate',
      question: 'Rebase onto main?',
      answer: 'Yes, rebase.',
      askedAt: AN_HOUR_AGO,
      answeredAt: AN_HOUR_AGO,
      overriddenBy: { text: 'No, merge first.', at: AN_HOUR_AGO }
    }
  ]
}

afterEach(() => {
  cleanup()
})

function renderSheet(
  onReply: (reply: GameMemberReply) => Promise<void> = async () => {},
  undelivered: GameOwnerQuestion[] = []
) {
  return render(
    <TeamInboxView
      projectName="orca-oss"
      projectUnread={null}
      answerAgentOf={() => null}
      questions={[]}
      undelivered={undelivered}
      onAnswer={async () => {}}
      otherGroups={[]}
      threads={THREADS}
      onReply={onReply}
      agentQuestions={[]}
      answeredQuestions={[]}
      onOpenAgent={() => {}}
      memberNames={new Map()}
    />
  )
}

const tab = (view: ReturnType<typeof render>, name: RegExp) => {
  const trigger = view.getByRole('tab', { name })
  act(() => {
    fireEvent.mouseDown(trigger)
    fireEvent.click(trigger)
  })
  return trigger
}

describe("Inbox tab: the lead's mail", () => {
  // Why (ORCA-1100): the Inbox read "answered" while the lead never got the answer.
  it('shows under For you an answer that has not reached the lead yet', () => {
    const view = renderSheet(undefined, [
      {
        id: 'oq_9',
        ticket: 'ORCA-1039',
        question: 'Does the warning still show?',
        options: [],
        context: null,
        askedAt: AN_HOUR_AGO,
        answer: { text: 'No', at: AN_HOUR_AGO, undelivered: true }
      }
    ])

    const notice = view.getByTestId('game-inbox-undelivered')
    // Why: retries stop after about 10 minutes, so the notice promises only the hand-over a lead's register makes.
    expect(notice.textContent).toContain(
      'Your answer has not reached the lead yet. Orca delivers it as soon as a lead takes it.'
    )
    expect(notice.textContent).not.toMatch(/retry/i)
    expect(within(notice).getByText('ORCA-1039')).toBeTruthy()
    expect(within(notice).getByText('Does the warning still show?')).toBeTruthy()
  })

  it('shows no undelivered notice when every answer reached the lead', () => {
    const view = renderSheet()

    expect(view.queryByTestId('game-inbox-undelivered')).toBeNull()
  })

  it('counts For you and Waiting on their tabs, and opens on For you', () => {
    const view = renderSheet()

    expect(view.getByRole('tab', { name: /For you/ }).getAttribute('data-state')).toBe('active')
    expect(view.getByRole('tab', { name: /Waiting/ }).textContent).toContain('1')
    expect(view.getByText('No questions are waiting for you.')).toBeTruthy()
    expect(view.getByTestId('team-panel-inbox')).toBeTruthy()
  })

  // V28's compact row (ORCA-1095): ticket, age and the question, no kind label or answerer line.
  it('lists under Waiting what the lead has not answered, with its ticket and age', () => {
    const view = renderSheet()
    tab(view, /Waiting/)

    const row = view.getByTestId('team-inbox-waiting-q1')
    expect(within(row).getByText('ORCA-12')).toBeTruthy()
    expect(within(row).getByText('Which port?')).toBeTruthy()
    expect(row.textContent).toMatch(/1 h/)
  })

  it("opens a ticket's thread from Threads: typed messages in order and the failure shown", () => {
    const view = renderSheet()
    tab(view, /Threads/)

    expect(view.getByTestId('game-inbox-thread-ORCA-14')).toBeTruthy()
    act(() => fireEvent.click(view.getByTestId('game-inbox-thread-ORCA-12')))

    const messages = view.getAllByTestId(/^game-inbox-message-/)
    expect(messages.map((one) => one.getAttribute('data-testid'))).toEqual([
      'game-inbox-message-m1',
      'game-inbox-message-m2'
    ])
    expect(within(messages[0]!).getByText('Dispatch')).toBeTruthy()
    expect(within(messages[1]!).getByText('Report')).toBeTruthy()
    expect(within(messages[1]!).getByRole('alert').textContent).toMatch(
      /Rejected: summary is empty/
    )

    act(() => fireEvent.click(view.getByRole('button', { name: /All threads/ })))
    expect(view.getByTestId('game-inbox-thread-ORCA-14')).toBeTruthy()
  })

  it('audits under Answered what the lead answered and when', () => {
    const view = renderSheet()
    tab(view, /Answered/)

    const row = view.getByTestId('team-inbox-answered-q0')
    expect(within(row).getByText('Rebase onto main?')).toBeTruthy()
    // Why your words only: once you override the lead, your answer is the one that stands.
    expect(within(row).getByText('You answered: No, merge first.')).toBeTruthy()
    expect(row.textContent).toMatch(/1 h/)
  })

  it('answers a waiting member for the person, and shows why a reply failed', async () => {
    const onReply = vi.fn(async (reply: GameMemberReply) => {
      if (reply.text === 'late') {
        throw new Error('Its member is gone, so the reply was not sent.')
      }
    })
    const view = renderSheet(onReply)
    tab(view, /Waiting/)
    const row = view.getByTestId('team-inbox-waiting-q1')
    act(() => fireEvent.click(within(row).getByRole('button', { name: 'Answer' })))
    const box = within(row).getByRole('textbox', { name: /Your answer to ORCA-12/ })
    expect(box.getAttribute('placeholder')).toBe('Your answer')

    act(() => fireEvent.change(box, { target: { value: '8080' } }))
    act(() => fireEvent.submit(box))
    await waitFor(() =>
      expect(onReply).toHaveBeenCalledWith({ id: 'q1', text: '8080', ticket: 'ORCA-12' })
    )

    act(() => fireEvent.change(box, { target: { value: 'late' } }))
    act(() => fireEvent.submit(box))
    expect((await within(row).findByRole('alert')).textContent).toMatch(/member is gone/)
  })

  it("overrides the lead's answer from Answered", async () => {
    const onReply = vi.fn(async () => {})
    const view = renderSheet(onReply)
    tab(view, /Answered/)
    const row = view.getByTestId('team-inbox-answered-q0')

    expect(within(row).queryByRole('textbox')).toBeNull()
    act(() => fireEvent.click(within(row).getByRole('button', { name: /Override/ })))
    const box = within(row).getByRole('textbox', { name: /Your answer to ORCA-14/ })
    act(() => fireEvent.change(box, { target: { value: 'No, merge first.' } }))
    act(() => fireEvent.submit(box))

    await waitFor(() =>
      expect(onReply).toHaveBeenCalledWith({
        id: 'q0',
        text: 'No, merge first.',
        ticket: 'ORCA-14'
      })
    )
  })
})
