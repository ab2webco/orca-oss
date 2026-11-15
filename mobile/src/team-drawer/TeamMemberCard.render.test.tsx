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
