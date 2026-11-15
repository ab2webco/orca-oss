import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { teamCardWordsOf } from './team-card-words'
import type { TeamMemberRow } from './team-drawer-model'
import { TeamMemberCard } from './TeamMemberCard'

const row = (over: Partial<TeamMemberRow>): TeamMemberRow => ({
  key: 'k',
  name: 'Arquera',
  ticket: 'ORCA-5',
  title: null,
  state: 'idle',
  needsYou: false,
  host: null,
  agent: 'claude',
  model: null,
  pr: null,
  ticketStatus: null,
  live: null,
  since: null,
  phase: null,
  summary: null,
  terminal: null,
  account: null,
  limit: null,
  hold: null,
  ...over
})

const texts = (): string[] =>
  [...document.body.querySelectorAll<HTMLElement>('div')]
    .filter((one) => one.childElementCount === 0)
    .map((one) => one.textContent ?? '')
    .filter(Boolean)

describe('TeamMemberCard', () => {
  let container: HTMLDivElement
  let root: Root
  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })
  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })
  const show = (member: TeamMemberRow, locale: 'en' | 'es' = 'en') =>
    act(() =>
      root.render(
        <TeamMemberCard
          member={member}
          hostName="m1"
          now={0}
          words={teamCardWordsOf(locale)}
          expanded={false}
          onToggle={vi.fn()}
          onAnswer={vi.fn()}
          onOpenLink={vi.fn()}
          onOpenTerminal={vi.fn()}
        />
      )
    )

  it('says a member a STOP paused is paused, and a queued launch what it waits on', () => {
    show(row({ hold: { kind: 'paused' } }))
    expect(texts()).toContain('Paused')
    show(row({ name: 'Mago', hold: { kind: 'queued', waitingOn: 'waiting for a free slot' } }))
    expect(texts()).toContain('Queued')
    expect(texts()).toContain('waiting for a free slot')
  })

  it("words them in the host's language", () => {
    show(row({ hold: { kind: 'paused' } }), 'es')
    expect(texts()).toContain('En pausa')
  })
})

// Why (ORCA-1231, ORCA-1205): the phone said "Waiting for your answer" for a prompt in the pane and
// read a stopped member on red CI by its raw state.
describe('TeamMemberCard and what it waits on', () => {
  let container: HTMLDivElement
  let root: Root
  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })
  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })
  const terminal = { worktreeId: 'repo::/wt', tabId: 'tab-2', terminal: 'term_2' }
  const show = (member: TeamMemberRow, onOpenTerminal = vi.fn(), onAnswer = vi.fn()) => {
    act(() =>
      root.render(
        <TeamMemberCard
          member={member}
          hostName="m1"
          now={0}
          words={teamCardWordsOf('en')}
          expanded={false}
          onToggle={vi.fn()}
          onAnswer={onAnswer}
          onOpenLink={vi.fn()}
          onOpenTerminal={onOpenTerminal}
        />
      )
    )
    return { onOpenTerminal, onAnswer }
  }
  const button = (label: string) =>
    document.body.querySelector<HTMLElement>(`[aria-label="${label}"]`)

  it('names a permission prompt and opens the pane that holds it', () => {
    const { onOpenTerminal, onAnswer } = show(
      row({
        state: 'waiting',
        needsYou: true,
        ask: { kind: 'permission', tool: 'Bash' },
        terminal
      })
    )
    expect(texts()).toContain('Permission prompt: Bash')
    expect(texts()).not.toContain('Waiting for your answer')
    expect(button('Answer in Inbox')).toBeNull()
    act(() => button('Answer in its terminal')?.click())
    expect(onOpenTerminal).toHaveBeenCalledWith(terminal)
    expect(onAnswer).not.toHaveBeenCalled()
  })

  it('keeps the Inbox for a question the Inbox holds', () => {
    show(row({ needsYou: true, ask: { kind: 'inbox' } }))
    expect(texts()).toContain('Waiting for your answer')
    expect(button('Answer in Inbox')).not.toBeNull()
  })

  it('says CI is failing for a stopped member on red CI', () => {
    show(row({ state: 'idle', idleCi: 'failure' }))
    expect(texts()).toContain('CI failing')
    expect(texts()).not.toContain('Idle')
  })
})
