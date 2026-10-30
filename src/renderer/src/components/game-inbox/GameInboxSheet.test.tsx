// @vitest-environment happy-dom

import { act, cleanup, fireEvent, render, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { GameInboxThreads } from '../../../../shared/orchestrator-game-inbox-threads'
import { GameInboxSheet } from './GameInboxSheet'
import type { GameMemberReply } from './game-inbox-threads-client'

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

function renderSheet(onReply: (reply: GameMemberReply) => Promise<void> = async () => {}) {
  return render(
    <GameInboxSheet
      open
      onOpenChange={() => {}}
      questions={[]}
      onAnswer={async () => {}}
      threads={THREADS}
      onReply={onReply}
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

describe('GameInboxSheet', () => {
  it('counts For you and Waiting on their tabs, and opens on For you', () => {
    const view = renderSheet()

    expect(view.getByRole('tab', { name: /For you/ }).getAttribute('data-state')).toBe('active')
    expect(view.getByRole('tab', { name: /Waiting/ }).textContent).toContain('1')
    expect(view.getByText('No questions are waiting for you.')).toBeTruthy()
  })

  it('lists under Waiting what the lead has not answered, with its age and who must answer', () => {
    const view = renderSheet()
    tab(view, /Waiting/)

    const row = view.getByTestId('game-inbox-waiting-q1')
    expect(within(row).getByText('ORCA-12')).toBeTruthy()
    expect(within(row).getByText('Which port?')).toBeTruthy()
    expect(within(row).getByText('Question')).toBeTruthy()
    expect(row.textContent).toMatch(/lead must answer/)
    expect(row.textContent).toMatch(/1 hour ago/)
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

    const row = view.getByTestId('game-inbox-answered-q0')
    expect(within(row).getByText('Rebase onto main?')).toBeTruthy()
    expect(within(row).getByText('Yes, rebase.')).toBeTruthy()
    expect(within(row).getByText('Decision')).toBeTruthy()
    expect(row.textContent).toMatch(/You replaced it: No, merge first\./)
  })

  it('answers a waiting member for the person, and shows why a reply failed', async () => {
    const onReply = vi.fn(async (reply: GameMemberReply) => {
      if (reply.text === 'late') {
        throw new Error('Its member is gone, so the reply was not sent.')
      }
    })
    const view = renderSheet(onReply)
    tab(view, /Waiting/)
    const row = view.getByTestId('game-inbox-waiting-q1')
    const box = within(row).getByRole('textbox', { name: /Your answer to ORCA-12/ })

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
    const row = view.getByTestId('game-inbox-answered-q0')

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
