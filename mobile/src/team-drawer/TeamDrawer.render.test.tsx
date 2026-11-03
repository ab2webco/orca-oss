import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Why: lucide's circular ESM re-exports do not load under Vite's runner; icons are not under test.
vi.mock('lucide-react-native', async () => {
  const { createElement: h } = await import('react')
  const Icon = () => h('span')
  return new Proxy(
    {},
    {
      get: (_target, name) => (typeof name === 'string' && name !== 'then' ? Icon : undefined),
      has: (_target, name) => typeof name === 'string' && name !== 'then'
    }
  )
})

import { TeamDrawer } from './TeamDrawer'
import { teamLeadViewOf, type TeamDrawerData } from './team-drawer-model'

const question = {
  id: 'q1',
  ticket: 'ORCA-7',
  question: 'Merge the chain now?',
  options: ['Yes', 'No'],
  context: null,
  askedAt: '2026-11-02T10:00:00.000Z',
  answer: null
}

const waiting = {
  id: 'msg_w',
  ticket: 'ORCA-3',
  kind: 'decision_gate' as const,
  subject: 'Pick the port',
  body: 'Use 6768 or 6769?',
  at: '2026-11-02T09:00:00.000Z',
  answerer: 'lead'
}
const answered = {
  id: 'msg_a',
  ticket: 'ORCA-1',
  kind: 'question' as const,
  question: 'Rebase before review?',
  answer: 'Yes, rebase first.',
  askedAt: '2026-11-02T08:00:00.000Z',
  answeredAt: '2026-11-02T08:05:00.000Z'
}
const thread = {
  ticket: 'ORCA-1',
  last: '2026-11-02T08:05:00.000Z',
  waiting: 0,
  messages: [
    {
      id: 'm1',
      at: '2026-11-02T08:00:00.000Z',
      from: 'ORCA-1',
      to: 'lead',
      kind: 'question',
      subject: 'Rebase?',
      body: 'Rebase on main?',
      failure: null
    },
    {
      id: 'm2',
      at: '2026-11-02T08:05:00.000Z',
      from: 'lead',
      to: 'ORCA-1',
      kind: 'answer',
      subject: 'Re: Rebase?',
      body: 'Yes, rebase first.',
      failure: null
    }
  ]
}

const member = (paneKey: string, displayName: string, state: string) => ({
  paneKey,
  displayName,
  agentType: 'claude',
  state,
  toolName: null,
  isLeader: false,
  isMember: true
})

function teamWith(over: Partial<TeamDrawerData> = {}): TeamDrawerData {
  const view = teamLeadViewOf(
    {
      role: 'lead',
      lead: { autostart: false, cap: 4, agent: 'claude' },
      agents: [member('a', 'ORCA-1 idle one', 'idle'), member('b', 'ORCA-7 asker', 'working')],
      metrics: {
        mergedPerDay: [{ day: '2026-11-02', merged: 4 }],
        leadTime: { medianMs: 2 * 3_600_000, measured: 4 }
      }
    },
    new Set(['ORCA-7'])
  )
  return {
    view,
    questions: [question],
    answerWorktreeId: 'repo::/main',
    badge: null,
    inbox: {
      kind: 'ready',
      threads: { threads: [thread], waiting: [waiting], answered: [answered] }
    },
    answer: vi.fn(async () => {}),
    ...over
  }
}

const safeArea = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 0, left: 0, right: 0, bottom: 0 }
}

const texts = (): string[] =>
  [...document.body.querySelectorAll<HTMLElement>('div')]
    .filter((one) => one.childElementCount === 0)
    .map((one) => one.textContent ?? '')

function button(label: string): HTMLElement {
  const found = document.body.querySelector<HTMLElement>(`[aria-label="${label}"]`)
  if (!found) {
    throw new Error(`no control labelled ${label}`)
  }
  return found
}

describe('TeamDrawer', () => {
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

  const show = (team: TeamDrawerData, onClose = vi.fn()) => {
    act(() =>
      root.render(
        <SafeAreaProvider initialMetrics={safeArea}>
          <TeamDrawer visible onClose={onClose} team={team} now={0} onOpenLink={() => {}} />
        </SafeAreaProvider>
      )
    )
    return onClose
  }

  it("opens on the lead's Inbox while a question waits, then shows the Team tab on a tap", () => {
    show(teamWith())
    expect(button('Inbox').getAttribute('aria-selected')).toBe('true')
    expect(texts()).toContain('For you (1)')
    expect(texts()).toContain('Merge the chain now?')
    expect(texts()).not.toContain('Metrics')

    act(() => button('Team').click())
    const shown = texts()
    const at = (text: string) => shown.indexOf(text)
    expect(shown).not.toContain('Merge the chain now?')
    expect(at('ORCA-7')).toBeLessThan(at('ORCA-1'))
    expect(at('Metrics')).toBeGreaterThan(at('ORCA-1'))
    expect(shown).toContain('2.0 h')
  })

  it("lists what waits on the lead, its answers, and each ticket's thread on a tap", () => {
    show(teamWith())
    const shown = texts()
    expect(shown).toContain('Waiting on the lead (1)')
    expect(shown).toContain('Pick the port')
    expect(shown).toContain('Decision')
    expect(shown).toContain('Yes, rebase first.')
    expect(shown).not.toContain('Rebase on main?')

    act(() => button('Open the ORCA-1 thread, 2 messages').click())
    expect(texts()).toContain('Rebase on main?')
    expect(texts()).toContain('ORCA-1 → lead')
  })

  it('opens on the Team tab when no question waits', () => {
    show(teamWith({ questions: [] }))
    expect(button('Team').getAttribute('aria-selected')).toBe('true')
    expect(texts()).toContain('Members (2)')
  })

  it('says the host must update when its phone allowlist predates the Inbox', () => {
    show(teamWith({ questions: [], inbox: { kind: 'unavailable' } }))
    act(() => button('Inbox').click())
    expect(texts()).toContain("Update Orca on this computer to read the lead's Inbox here.")
  })

  // Why: at 375 pt the tile wrapped "Merged in 4 d" with the "d" alone on its own line.
  it('keeps the window unit on the line of its number', () => {
    show(teamWith({ questions: [] }))
    expect(texts().filter((one) => one.startsWith('Merged in'))).toEqual(['Merged in 1 d'])
  })

  it('closes from the large X in the header', () => {
    const onClose = show(teamWith())
    const close = button('Close Team')
    expect(getComputedStyle(close).width).toBe('44px')
    act(() => close.click())
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('sends one answer through the board for a tapped option', async () => {
    const team = teamWith()
    show(team)
    await act(async () => button('Answer Yes').click())
    expect(team.answer).toHaveBeenCalledTimes(1)
    expect(team.answer).toHaveBeenCalledWith('q1', { option: 1 })
  })

  it('omits sections an older host does not send', () => {
    const view = teamWith().view
    show(teamWith({ questions: [], view: view && { ...view, metrics: null } }))
    const shown = texts()
    expect(shown).not.toContain('Metrics')
    expect(shown.some((one) => one.startsWith('Needs your answer'))).toBe(false)
    expect(shown).toContain('Members (2)')
  })

  // Why: a 48 px strip of the lead's terminal peeked beside the drawer on a phone.
  it('fills the phone width with square edges', () => {
    show(teamWith())
    const panel = [...document.body.querySelectorAll<HTMLElement>('div')].find(
      (one) => getComputedStyle(one).width === '390px'
    )
    expect(panel).toBeDefined()
    expect(getComputedStyle(panel!).borderTopLeftRadius).toBe('0px')
  })

  // Why: at 320 pt the tiles broke "2026-11-02" across lines and left one tile alone.
  it('lists metrics as full-width rows with whole labels', () => {
    show(teamWith())
    const label = [...document.body.querySelectorAll<HTMLElement>('div')].find(
      (one) => one.childElementCount === 0 && one.textContent === 'Merged on 2026-11-02'
    )
    expect(label).toBeDefined()
    const list = label!.parentElement!.parentElement!
    expect(getComputedStyle(list).flexDirection).toBe('column')
  })
})
