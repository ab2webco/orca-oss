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

import { TeamSheet } from './TeamSheet'
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

const member = (
  paneKey: string,
  displayName: string,
  state: string,
  over: Record<string, unknown> = {}
) => ({
  paneKey,
  displayName,
  agentType: 'claude',
  state,
  toolName: null,
  isLeader: false,
  isMember: true,
  ...over
})

const NOW = 20 * 60_000

function teamWith(over: Partial<TeamDrawerData> = {}): TeamDrawerData {
  const view = teamLeadViewOf(
    {
      role: 'lead',
      lead: { autostart: false, cap: 4, agent: 'claude' },
      worktree: { id: 'repo::/lead' },
      inboxes: [
        {
          key: 'ORCA-9',
          unread: 0,
          last: { at: 'x', from: 'ORCA-9', subject: 'Tests green, opening the PR' },
          waiting: []
        }
      ],
      agents: [
        member('a', 'ORCA-1 idle one', 'idle'),
        member('b', 'ORCA-7 asker', 'working'),
        member('c', 'Juno', 'working', {
          workItem: {
            provider: 'plane',
            identifier: 'ORCA-9',
            title: 'Terminal role pill',
            url: 'u',
            status: 'In Progress',
            statusGroup: 'started'
          },
          toolName: 'Edit',
          toolInput: 'terminal-role.ts',
          stateSince: 8 * 60_000,
          launch: { model: 'opus', effort: 'high' },
          account: { provider: 'claude', id: 'a', email: 'dev@example.com' },
          review: {
            provider: 'github',
            number: 850,
            title: 'p',
            url: 'https://pr/850',
            state: 'open',
            ci: 'success',
            ciHistory: [
              { headSha: 'a', ci: 'failure' },
              { headSha: 'b', ci: 'success' }
            ],
            commentCount: 3
          }
        }),
        member('d', 'Rho', 'idle', {
          limit: { resetsAt: null, loggedOut: true },
          remote: { host: 'iMac', stateKnown: true }
        })
      ],
      metrics: {
        claudeAccounts: [{ email: 'dev@example.com', sessionPercent: 37, weeklyPercent: 61 }],
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

describe('TeamSheet', () => {
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

  const onOpenTerminal = vi.fn()
  const render = (team: TeamDrawerData, open: boolean, onOpenChange = vi.fn()) => {
    act(() =>
      root.render(
        <SafeAreaProvider initialMetrics={safeArea}>
          <TeamSheet
            open={open}
            onOpenChange={onOpenChange}
            team={team}
            now={NOW}
            onOpenLink={() => {}}
            onOpenTerminal={onOpenTerminal}
          />
        </SafeAreaProvider>
      )
    )
    return onOpenChange
  }
  const show = (team: TeamDrawerData, onOpenChange = vi.fn()) => render(team, true, onOpenChange)

  it('peeks 60 pt tall with who needs you, and opens on a tap', () => {
    const onOpenChange = render(teamWith(), false)
    const peek = button('Open Team, 1 needs you')
    expect(getComputedStyle(peek).height).toBe('60px')
    expect(texts()).toContain('1 needs you')
    expect(document.body.querySelector('[role="tablist"]')).toBeNull()
    act(() => peek.click())
    expect(onOpenChange).toHaveBeenCalledWith(true)
  })

  it('peeks with who works when nobody needs you', () => {
    render(teamWith({ questions: [] }), false)
    expect(texts()).toContain('2 working · 4 members')
  })

  it("opens to 84% of the screen with rounded top corners, over the lead's terminal", () => {
    show(teamWith())
    const rounded = [...document.body.querySelectorAll<HTMLElement>('div')]
      .filter((one) => getComputedStyle(one).borderTopLeftRadius === '14px')
      .map((one) => getComputedStyle(one).height)
    expect(rounded).toContain(`${Math.round(844 * 0.84)}px`)
  })

  it("shows each member's tool, time in state, model, account quota, CI per push and comments", () => {
    show(teamWith({ questions: [] }))
    const shown = texts()
    expect(shown).toContain('Edit · terminal-role.ts')
    expect(shown).toContain('opus · high · Coding · 12 min · In Progress')
    expect(shown).toContain('dev@example.com · 5 h 37% · 7 d 61%')
    expect(shown).toContain('CI green')
    expect(shown).toContain('3 comments')
    expect(button('CI per push: failure, success')).toBeDefined()
    expect(shown).toContain('Logged out')
  })

  it("opens a card on a tap to its ticket title, summary and the member's terminal", () => {
    const onOpenChange = show(teamWith({ questions: [] }))
    expect(texts()).not.toContain('Terminal role pill')
    expect(texts()).not.toContain('Tests green, opening the PR')
    const card = button('Juno, Edit · terminal-role.ts')
    expect(card.getAttribute('aria-expanded')).toBe('false')
    act(() => card.click())
    expect(card.getAttribute('aria-expanded')).toBe('true')
    expect(texts()).toContain('Terminal role pill')
    expect(texts()).toContain('Tests green, opening the PR')
    act(() => button('Open terminal').click())
    expect(onOpenTerminal).toHaveBeenCalledWith({
      worktreeId: 'repo::/lead',
      tabId: 'c',
      terminal: null
    })
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it("names the host instead of a terminal button for a paired host's member", () => {
    show(teamWith({ questions: [] }))
    act(() => button('Rho, Logged out').click())
    expect(texts()).toContain('Its terminal is on iMac')
    expect(document.body.querySelector('[aria-label="Open terminal"]')).toBeNull()
  })

  it('takes a waiting card to the Inbox in one tap', () => {
    show(teamWith())
    act(() => button('Team').click())
    act(() => button('Answer in Inbox').click())
    expect(button('Inbox').getAttribute('aria-selected')).toBe('true')
  })

  it("words the sheet and its cards in the host's language", () => {
    const team = teamWith()
    show({ ...team, view: team.view && { ...team.view, locale: 'es' } })
    expect(texts()).toContain('1 te necesita')
    expect(button('Bandeja').getAttribute('aria-selected')).toBe('true')
    act(() => button('Equipo').click())
    act(() => button('Juno, Edit · terminal-role.ts').click())
    const shown = texts()
    expect(shown).toContain('Miembros (4)')
    expect(shown).toContain('Esperando tu respuesta')
    expect(shown).toContain('Responder en Bandeja')
    expect(shown).toContain('opus · high · Programando · 12 min · In Progress')
    expect(shown).toContain('Abrir terminal')
    expect(shown).toContain('Sesión cerrada en la cuenta')
    expect(shown).toContain('Métricas')
    expect(shown).toContain('Mergeados en 1 d')
    expect(button('Cerrar Equipo, 1 te necesita')).toBeDefined()
  })

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

  it('lists what waits on the lead and its answers', () => {
    show(teamWith())
    const shown = texts()
    expect(shown).toContain('Waiting on the lead (1)')
    expect(shown).toContain('Pick the port')
    expect(shown).toContain('Decision')
    expect(shown).toContain('Yes, rebase first.')
  })

  it("shows each ticket's thread collapsed, and its messages on a tap", () => {
    show(teamWith())
    expect(texts()).toContain('Threads (1)')
    expect(texts()).not.toContain('Rebase on main?')

    act(() => button('Open the ORCA-1 thread, 2 messages').click())
    expect(texts()).toContain('Rebase on main?')
    expect(texts()).toContain('ORCA-1 → lead')
  })

  it('opens on the Team tab when no question waits', () => {
    show(teamWith({ questions: [] }))
    expect(button('Team').getAttribute('aria-selected')).toBe('true')
    expect(texts()).toContain('Members (4)')
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

  it('closes from the peek at the top of the open sheet', () => {
    const onOpenChange = show(teamWith())
    const close = button('Close Team, 1 needs you')
    expect(getComputedStyle(close).height).toBe('60px')
    act(() => close.click())
    expect(onOpenChange).toHaveBeenCalledWith(false)
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
    expect(shown).toContain('Members (4)')
  })

  // Why: at 320 pt the tiles broke "2026-11-02" across lines and left one tile alone.
  it('lists metrics as full-width rows with whole labels', () => {
    show(teamWith({ questions: [] }))
    const label = [...document.body.querySelectorAll<HTMLElement>('div')].find(
      (one) => one.childElementCount === 0 && one.textContent === 'Merged on 2026-11-02'
    )
    expect(label).toBeDefined()
    const list = label!.parentElement!.parentElement!
    expect(getComputedStyle(list).flexDirection).toBe('column')
  })
})
