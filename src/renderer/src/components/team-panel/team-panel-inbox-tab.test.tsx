// @vitest-environment happy-dom

import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { GameOwnerQuestion } from '../../../../shared/orchestrator-game-owner-questions'
import type { GameInboxThreads } from '../../../../shared/orchestrator-game-inbox-threads'
import type { GameInboxQuestionGroup } from '@/components/game-inbox/use-other-game-inbox-groups'
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
          subject: 'ORCA-1039: Approach approved',
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

const otherGroup = (): GameInboxQuestionGroup => ({
  key: 'env-imac\u0000repo-web',
  title: 'Ab2Web',
  host: 'imac',
  questions: [question('q-web', 'Ship the price change today?', 'WEB-212')],
  onAnswer: vi.fn(async () => {})
})

function renderInbox(
  over: Partial<React.ComponentProps<typeof TeamInboxView>> = {}
): ReturnType<typeof render> {
  const other = otherGroup()
  return render(
    <TeamInboxView
      projectName="orca-oss"
      projectUnread={null}
      questions={[question('q-1', 'Merge #923 now or wait for #915?', 'ORCA-1039')]}
      undelivered={[]}
      onAnswer={vi.fn(async () => {})}
      otherGroups={[other]}
      threads={THREADS}
      onReply={vi.fn(async () => {})}
      agentQuestions={[]}
      answeredQuestions={[]}
      onOpenAgent={vi.fn()}
      answerAgentOf={() => null}
      memberNames={new Map([['ORCA-1033', 'Sabio']])}
      {...over}
    />
  )
}

const openOthers = (view: ReturnType<typeof render>): void => {
  act(() => {
    fireEvent.click(view.getByRole('button', { name: /Other projects/ }))
  })
}

const pick = (view: ReturnType<typeof render>, name: RegExp): void => {
  const trigger = view.getByRole('tab', { name })
  act(() => {
    fireEvent.mouseDown(trigger)
    fireEvent.click(trigger)
  })
}

describe('Inbox tab', () => {
  // ORCA-1169: another project's question read as this one's; it now waits folded under its own heading.
  it('opens on For you with this project first and other projects folded below', () => {
    const view = renderInbox()

    expect(view.getByRole('tab', { name: /For you/ }).getAttribute('data-state')).toBe('active')
    expect(view.getByRole('tab', { name: /For you/ }).textContent).toBe('For you1')
    expect(view.getByText('orca-oss · this project')).toBeTruthy()
    expect(view.getByText('Merge #923 now or wait for #915?')).toBeTruthy()
    const others = view.getByRole('button', { name: /Other projects/ })
    expect(others.textContent).toBe('Other projects1')
    expect(others.getAttribute('aria-expanded')).toBe('false')
    expect(view.queryByText('Ship the price change today?')).toBeNull()
    const sections = [...view.container.querySelectorAll('[data-team-inbox-project]')]
    expect(sections.map((one) => one.getAttribute('data-team-inbox-project'))).toEqual([
      'active',
      'others'
    ])
  })

  it('opens other projects, each titled with its project and host, still answerable', async () => {
    const onAnswer = vi.fn(async () => {})
    const local: GameInboxQuestionGroup = {
      key: 'local\u0000repo-wa',
      title: 'orca-wa-inbox',
      host: null,
      questions: [question('q-wa', 'Retry the webhook?', 'WAINBOX-79')],
      onAnswer
    }
    const view = renderInbox({ otherGroups: [local, otherGroup()] })

    const others = view.getByRole('button', { name: /Other projects/ })
    expect(others.textContent).toBe('Other projects2')
    openOthers(view)

    expect(others.getAttribute('aria-expanded')).toBe('true')
    expect(view.getByText('orca-wa-inbox')).toBeTruthy()
    expect(view.getByText('Ab2Web · imac')).toBeTruthy()
    const card = view.container.querySelector('[data-game-owner-question="q-wa"]')
    await act(async () => fireEvent.click(card?.querySelector('button') as HTMLButtonElement))
    expect(onAnswer).toHaveBeenCalledWith('q-wa', { option: 1 })
  })

  it('says nothing waits here, above the folded other projects', () => {
    const view = renderInbox({ questions: [] })

    expect(view.getByRole('tab', { name: /For you/ }).textContent).toBe('For you0')
    const empty = view.getByText('No questions are waiting for you.')
    const others = view.getByRole('button', { name: /Other projects/ })
    expect(empty.compareDocumentPosition(others) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(view.queryByText('Ship the price change today?')).toBeNull()
  })

  // Why: with one project there is nothing to fold, so no heading appears.
  it('draws no other-projects heading when only this project asks', () => {
    const view = renderInbox({ otherGroups: [] })

    expect(view.queryByRole('button', { name: /Other projects/ })).toBeNull()
    expect(view.getByText('Merge #923 now or wait for #915?')).toBeTruthy()
  })

  it("marks this project's question as the one to act on, as V28 does", () => {
    const view = renderInbox()
    openOthers(view)
    const mine = view.container.querySelector<HTMLElement>('[data-game-owner-question="q-1"]')!
    const other = view.container.querySelector<HTMLElement>('[data-game-owner-question="q-web"]')!

    expect(mine.getAttribute('data-needs-you')).toBe('true')
    expect(mine.textContent).toContain('Needs you')
    expect(mine.className).toContain('bg-status-attention')
    const [first, second] = [...mine.querySelectorAll('button')].filter((one) =>
      ['Merge now', 'Wait for #915'].includes(one.textContent ?? '')
    )
    expect(first.getAttribute('data-variant')).toBe('default')
    expect(second.getAttribute('data-variant')).toBe('secondary')
    expect(other.getAttribute('data-needs-you')).toBeNull()
    expect(other.textContent).not.toContain('Needs you')
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
    openOthers(view)
    expect(view.getByText('Ship the price change today?')).toBeTruthy()
  })

  // ORCA-1142: at 219 px the strip drops its zero counts first, so a waiting count stays in sight.
  it.each([
    [3, ['For you1', 'Waiting', 'Threads1', 'Done']],
    [4, ['For you', 'Waiting', 'Threads', 'Done']]
  ])('fits a narrow strip at level %i, dropping zero counts first', (fitsAt, labels) => {
    const strip = (node: HTMLElement): boolean => node.getAttribute('role') === 'tablist'
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(
      function (this: HTMLElement) {
        return strip(this) ? 200 : 0
      }
    )
    vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockImplementation(
      function (this: HTMLElement) {
        return strip(this) && Number(this.dataset.fit) < fitsAt ? 300 : 0
      }
    )
    const view = renderInbox({ threads: { ...THREADS, waiting: [], answered: [] } })

    expect(view.getAllByRole('tab').map((tab) => tab.textContent)).toEqual(labels)
    vi.restoreAllMocks()
  })

  it('counts and lists Waiting, Threads and Answered', () => {
    const view = renderInbox()

    expect(view.getByRole('tab', { name: /Waiting/ }).textContent).toContain('1')
    expect(view.getByRole('tab', { name: /Threads/ }).textContent).toContain('1')
    expect(view.getByRole('tab', { name: /Answered/ }).textContent).toContain('1')

    pick(view, /Waiting/)
    expect(view.getByText(/Rebase #917 now or wait for #913\?/)).toBeTruthy()

    pick(view, /Threads/)
    expect(view.getByTestId('game-inbox-thread-ORCA-1039')).toBeTruthy()

    pick(view, /Answered/)
    expect(view.getByText('Include #911 in lab.115?')).toBeTruthy()
  })

  it('lists Waiting compactly, as V28 does: ticket, age, and who asks what', () => {
    const view = renderInbox()
    pick(view, /Waiting/)
    const row = view.getByTestId('team-inbox-waiting-w1')

    expect(row.textContent).toContain('ORCA-1033')
    expect(row.textContent).toContain('Sabio: Rebase #917 now or wait for #913?')
    expect(row.textContent).not.toContain('must answer')
    expect(row.className).not.toContain('border')
    // Why behind a button: answering a member is the exception; the lead answers by default.
    expect(view.queryByPlaceholderText('Your answer')).toBeNull()
    act(() => fireEvent.click(view.getByRole('button', { name: 'Answer' })))
    expect(view.getByPlaceholderText('Your answer')).toBeTruthy()
  })

  it('names a member with no ticket and never shows a raw dispatch id (ORCA-1136)', () => {
    const item = THREADS.waiting[0]!
    const view = renderInbox({
      threads: {
        ...THREADS,
        waiting: [
          { ...item, id: 'w-main', ticket: 'main', body: 'Reply member ready?' },
          { ...item, id: 'w-raw', ticket: 'dispatch:ctx_1fa802c37732', body: 'Which port?' }
        ],
        answered: [{ ...THREADS.answered[0]!, ticket: 'main' }]
      }
    })
    pick(view, /Waiting/)
    const named = view.getByTestId('team-inbox-waiting-w-main')
    const raw = view.getByTestId('team-inbox-waiting-w-raw')

    expect(named.textContent).toContain('main: Reply member ready?')
    expect(named.querySelector('code')).toBeNull()
    expect(raw.textContent).not.toContain('ctx_')
    expect(raw.textContent).toContain('Which port?')

    pick(view, /Answered/)
    const answered = view.getByTestId('team-inbox-answered-a1')
    expect(answered.textContent).toContain('main')
    expect(answered.querySelector('code')).toBeNull()
  })

  it('lists a thread with its message count and last line, the ticket said once', () => {
    const view = renderInbox()
    pick(view, /Threads/)
    const row = view.getByTestId('game-inbox-thread-ORCA-1039')

    expect(row.textContent).toContain('1 message')
    expect(row.textContent).toContain('Approach approved')
    expect(row.textContent!.match(/ORCA-1039/g)).toHaveLength(1)
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

  // Why: the sidebar entry stayed up for a held answer, so an empty Inbox must not hide one.
  it('shows a held answer when every list is empty', () => {
    const view = renderInbox({
      questions: [],
      otherGroups: [],
      threads: { threads: [], waiting: [], answered: [] },
      undelivered: [question('q-held', 'Does the warning still show?', 'ORCA-1039')]
    })

    expect(view.getByTestId('game-inbox-undelivered').textContent).toContain(
      'Does the warning still show?'
    )
    expect(view.queryByText('Nothing waits for you')).toBeNull()
  })

  // Why: with no team, a blocked agent's question comes from its AgentStatusEntry, not the board.
  it('lists an agent that asks, with its options and a way to its terminal', () => {
    const onOpenAgent = vi.fn()
    const agent = {
      paneKey: 'tab-1:leaf-1',
      terminalHandle: null,
      worktreeId: 'wt-tooltip',
      host: { kind: 'local' as const },
      repoName: 'orca-oss',
      worktreeName: 'fix-tooltip',
      text: 'Apply the migration now or leave it for the release?',
      options: ['Apply it now', 'Leave it for the release']
    }
    const view = renderInbox({
      questions: [],
      otherGroups: [],
      agentQuestions: [agent],
      onOpenAgent
    })

    expect(view.getByRole('tab', { name: /For you/ }).textContent).toContain('1')
    expect(view.getByText('orca-oss · fix-tooltip')).toBeTruthy()
    expect(view.getByText(agent.text)).toBeTruthy()
    expect(view.getByText('Apply it now · Leave it for the release')).toBeTruthy()
    act(() => fireEvent.click(view.getByRole('button', { name: 'Open terminal' })))
    expect(onOpenAgent).toHaveBeenCalledWith(agent)
  })

  // Why (ORCA-1141): V28 groups a member's question under this project in the tinted Needs-you card.
  it("shows a team agent's question under this project as V28's Needs-you card, with its asker", () => {
    const answer = vi.fn(() => true)
    const agent = {
      paneKey: 'tab-m:leaf-m',
      terminalHandle: 'term_m',
      worktreeId: 'wt-m',
      host: { kind: 'local' as const },
      repoName: 'orca-oss',
      worktreeName: 'Peach',
      asker: 'ORCA-12',
      text: 'Rebase on #1077 before the PR?',
      options: ['Rebase now', 'Leave it']
    }
    const view = renderInbox({
      questions: [],
      agentQuestions: [agent],
      answerAgentOf: () => answer
    })

    const project = view.container.querySelector('[data-team-inbox-project="active"]')
    expect(project?.textContent).toContain('orca-oss · this project')
    const card = project?.querySelector(`[data-team-inbox-agent="tab-m:leaf-m"]`)
    expect(card?.getAttribute('data-needs-you')).toBe('true')
    expect(card?.textContent).toContain('Needs you')
    expect(card?.textContent).toContain('ORCA-12')
    expect(card?.textContent).not.toContain('orca-oss · Peach')
    expect(view.getByRole('button', { name: 'Open terminal' })).toBeTruthy()
  })

  // Why (ORCA-1141): a paired-host member opens through its handle, with no worktree in this window.
  it("opens a member's terminal by its handle when its worktree is unknown here", () => {
    const onOpenAgent = vi.fn()
    const agent = {
      paneKey: 'tab-9:leaf-9',
      terminalHandle: 'term_m1_9',
      worktreeId: null,
      host: { kind: 'remote' as const, name: 'm1', environmentId: 'env_m1', reachable: true },
      repoName: 'orca-oss',
      worktreeName: 'Arthur',
      asker: 'ORCA-9',
      text: 'Ship it?',
      options: ['Yes', 'No']
    }
    const view = renderInbox({
      questions: [],
      otherGroups: [],
      agentQuestions: [agent],
      onOpenAgent
    })

    // Why: V28's header names the ticket only, wherever the member runs.
    const header = view.getByText('ORCA-9')
    expect(header.textContent).toBe('ORCA-9')
    const open = view.getByRole('button', { name: 'Open terminal' }) as HTMLButtonElement
    expect(open.disabled).toBe(false)
    act(() => fireEvent.click(open))
    expect(onOpenAgent).toHaveBeenCalledWith(agent)
  })

  // Why (ORCA-1129 D5): V28 solo-many-inbox answers from the card; the options were text only.
  it("answers an agent's question with its option buttons, once", () => {
    const answer = vi.fn(() => true)
    const agent = {
      paneKey: 'tab-1:leaf-1',
      terminalHandle: null,
      worktreeId: 'wt-tooltip',
      host: { kind: 'local' as const },
      repoName: 'orca-oss',
      worktreeName: 'fix-tooltip',
      text: 'Apply the migration now?',
      options: ['Apply it now', 'Leave it for the release']
    }
    const view = renderInbox({
      questions: [],
      otherGroups: [],
      agentQuestions: [agent],
      answerAgentOf: () => answer
    })

    act(() => fireEvent.click(view.getByRole('button', { name: 'Leave it for the release' })))

    expect(answer).toHaveBeenCalledWith(1)
    const first = view.getByRole('button', { name: 'Apply it now' }) as HTMLButtonElement
    expect(first.disabled).toBe(true)
    expect(view.getByRole('button', { name: 'Open terminal' })).toBeTruthy()
  })

  it('lists what you answered beside what the lead answered', () => {
    const answered: GameOwnerQuestion = {
      ...question('q-old', 'Include #911 in lab.115?', 'ORCA-1011'),
      answer: { text: 'Yes, include it', at: AT }
    }
    const view = renderInbox({ answeredQuestions: [answered] })

    expect(view.getByRole('tab', { name: /Answered/ }).textContent).toContain('2')
    pick(view, /Answered/)
    // V28 is one plain list: no outlined cards, no second block with its own heading.
    expect(view.queryByText('You answered')).toBeNull()
    expect(view.queryByText('The lead answered')).toBeNull()
    expect(view.getByText('You answered: Yes, include it')).toBeTruthy()
    expect(view.getByText('The lead answered: Yes, include it')).toBeTruthy()
    const rows = view.getAllByTestId(/^team-inbox-answered-/)
    expect(rows).toHaveLength(2)
    expect(rows.every((row) => !row.className.includes('border'))).toBe(true)
  })

  it('says nothing waits when For you is empty', () => {
    const view = renderInbox({ questions: [], otherGroups: [] })

    expect(view.getByText('No questions are waiting for you.')).toBeTruthy()
  })
})
