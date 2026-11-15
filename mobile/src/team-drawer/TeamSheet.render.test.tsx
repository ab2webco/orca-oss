import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { BackHandler } from 'react-native'
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

// Why: Metro resolves the band's PNGs by require; the render runner only needs a source per image.
vi.mock('./team-scene-quest-art', () => ({
  teamSceneQuestArtOf: (style: string) => ({
    backdrop: { uri: `${style}/backdrop.png` },
    front: style === 'figures' ? { uri: 'figures/front.png' } : null,
    lead: { uri: `${style}/lead.png` },
    advisor: { uri: `${style}/advisor.png` },
    members: Array.from({ length: 8 }, (_, at) => ({ uri: `${style}/member-${at + 1}.png` }))
  })
}))

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

const ADVISOR_LINE =
  'Approved Sonnet 5.5 · high for ORCA-9: the change only touches its tests, so a smaller model is enough.'

const leader = {
  paneKey: 'tab-0:leaf',
  displayName: 'Lead pane',
  agentType: 'claude',
  state: 'working',
  toolName: 'Read',
  toolInput: 'ORCA-9',
  isLeader: true,
  isMember: false,
  launch: { model: 'Opus 5.5', effort: 'high' },
  advisor: {
    model: null,
    effort: null,
    pinned: { model: false, effort: false },
    line: ADVISOR_LINE
  }
}

function teamWith(
  over: Partial<TeamDrawerData> = {},
  lead: Record<string, unknown> | null = null,
  extra: Record<string, unknown> = {}
): TeamDrawerData {
  const view = teamLeadViewOf(
    {
      role: 'lead',
      lead: { autostart: false, cap: 4, agent: 'claude' },
      leadName: 'Castillo',
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
        ...(lead ? [lead] : []),
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
      },
      ...extra
    },
    new Set(['ORCA-7']),
    null,
    NOW
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
    level: null,
    sceneArt: null,
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
            hostName="m1"
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

  it("names the desktop for a member on the lead's own host, never 'local'", () => {
    show(teamWith({ questions: [] }))
    const shown = texts()
    expect(shown.filter((one) => one === 'm1')).toHaveLength(3)
    expect(shown).toContain('iMac')
    expect(shown).not.toContain('local')
  })

  it('shows the lead and its advisor after the members, with the whole advisor sentence', () => {
    show(teamWith({ questions: [] }, leader))
    const shown = texts()
    // Why last: the scene band above the tabs names the team too.
    const at = (text: string) => shown.lastIndexOf(text)
    expect(shown).toContain('Lead')
    expect(shown).toContain('Orchestrating · Read · ORCA-9')
    expect(shown).toContain('Opus 5.5 · high · Coordinates 4 agents')
    expect(at('Castillo')).toBeGreaterThan(at('Rho'))
    expect(at('Wizard')).toBeGreaterThan(at('Castillo'))
    expect(at('Metrics')).toBeGreaterThan(at('Wizard'))
    expect(shown).toContain('Advisor')
    expect(shown).toContain('Jev')
    expect(shown).toContain(ADVISOR_LINE)
    expect(shown.filter((one) => one === 'm1')).toHaveLength(4)
  })

  it("words the lead and advisor cards in the host's language", () => {
    const team = teamWith({ questions: [] }, leader)
    show({ ...team, view: team.view && { ...team.view, locale: 'es' } })
    const shown = texts()
    expect(shown).toContain('Líder')
    expect(shown).toContain('Orquestando · Read · ORCA-9')
    expect(shown).toContain('Opus 5.5 · high · Coordina 4 agentes')
    expect(shown).toContain('Mago')
  })

  it('shows no lead or advisor card when the host sends no lead agent', () => {
    show(teamWith({ questions: [] }))
    const shown = texts()
    expect(shown).not.toContain('Castillo')
    expect(shown).not.toContain('Advisor')
  })

  it("shows the team's level and XP above the tabs, as the desktop panel does", () => {
    show(teamWith({ questions: [], level: { level: 11, into: 240, need: 1100 } }))
    const shown = texts()
    expect(shown).toContain('Lv 11')
    expect(shown).toContain('240/1100 XP')
    expect(button('Lv 11, 240/1100 XP')).toBeDefined()
  })

  it('words the level in the host language, and shows none when the host sends no XP', () => {
    const team = teamWith({ questions: [], level: { level: 2, into: 0, need: 200 } })
    show({ ...team, view: team.view && { ...team.view, locale: 'es' } })
    expect(texts()).toContain('Nv 2')
    show(teamWith({ questions: [] }))
    expect(texts().some((one) => one.endsWith(' XP'))).toBe(false)
  })

  const GB = 1024 ** 3
  const work = {
    project: {
      reviews: {
        total: 2,
        url: 'https://github.com/acme/web/pulls',
        items: [
          {
            id: '#416',
            title: 'Webhook signature check',
            url: 'https://pr/416',
            status: 'success'
          },
          { id: '#415', title: 'Rate limit dashboard', url: 'https://pr/415', status: 'failure' }
        ]
      },
      todo: null,
      queue: {
        provider: 'github',
        entries: [
          {
            id: '#409',
            title: 'Checkout copy review',
            url: 'https://pr/409',
            position: 1,
            state: 'checks',
            since: null
          },
          {
            id: '#412',
            title: 'Retry policy',
            url: 'https://pr/412',
            position: 2,
            state: 'waiting',
            since: null
          }
        ]
      }
    },
    hostCapacity: [
      {
        host: 'local',
        status: 'ok',
        running: 2,
        cap: 5,
        cpuCoreCount: 8,
        totalMemory: 100 * GB,
        availableMemory: 39 * GB,
        loadAverage1m: 1
      },
      {
        host: 'imac',
        status: 'ok',
        running: 1,
        cpuCoreCount: 8,
        totalMemory: 16 * GB,
        availableMemory: 2 * GB,
        loadAverage1m: 1
      },
      { host: 'contabo', status: 'unreachable', running: 0 }
    ]
  }

  it('lists the merge queue, then open PRs failures first, and opens a PR on a tap', () => {
    const onOpenLink = vi.fn()
    act(() =>
      root.render(
        <SafeAreaProvider initialMetrics={safeArea}>
          <TeamSheet
            open
            onOpenChange={vi.fn()}
            team={teamWith({ questions: [] }, null, work)}
            now={NOW}
            hostName="m1"
            onOpenLink={onOpenLink}
            onOpenTerminal={onOpenTerminal}
          />
        </SafeAreaProvider>
      )
    )
    act(() => button('PRs').click())
    const shown = texts()
    const at = (text: string) => shown.indexOf(text)
    expect(shown).toContain('Merge queue')
    expect(shown).toContain('In checks')
    expect(shown).toContain('In queue')
    expect(shown).toContain('Open PRs')
    expect(at('Rate limit dashboard')).toBeLessThan(at('Webhook signature check'))
    expect(at('Checkout copy review')).toBeLessThan(at('Open PRs'))
    expect(shown).toContain('Check failed')
    expect(shown).toContain('Ready')
    act(() => button('#415 Rate limit dashboard, Check failed').click())
    expect(onOpenLink).toHaveBeenCalledWith('https://pr/415')
  })

  it('lists each host with its agents and memory, naming this desktop, and an offline one', () => {
    show(teamWith({ questions: [] }, null, work))
    act(() => button('Hosts').click())
    const shown = texts()
    expect(shown).toContain('m1')
    expect(shown).toContain('2 of 5 agents')
    expect(shown).toContain('Memory used 61%')
    expect(shown).toContain('imac')
    expect(shown).toContain('Low memory')
    expect(shown).toContain('2 of 16 GB free')
    expect(shown).toContain('contabo')
    expect(shown).toContain('Offline')
    expect(shown).not.toContain('local')
  })

  it('words the PRs and Hosts tabs in the host language', () => {
    const team = teamWith({ questions: [] }, null, work)
    show({ ...team, view: team.view && { ...team.view, locale: 'es' } })
    act(() => button('PRs').click())
    expect(texts()).toContain('Cola de merge')
    expect(texts()).toContain('Check falló')
    act(() => button('Hosts').click())
    expect(texts()).toContain('Poca memoria')
    expect(texts()).toContain('2 de 16 GB libres')
  })

  it('says an older host publishes no PRs or hosts, instead of an empty list', () => {
    show(teamWith({ questions: [] }))
    act(() => button('PRs').click())
    expect(texts()).toContain('This Orca host does not publish it yet.')
    act(() => button('Hosts').click())
    expect(texts()).toContain('This Orca host does not publish it yet.')
  })

  const gamePanel = (style: string, look = 'game') => ({
    panel: {
      look,
      style,
      tabs: { prs: true, queue: true, machines: true },
      advisor: true,
      arcade: true
    }
  })

  it('draws the scene band 128 pt tall above the tabs, with the lead, members and Jev', () => {
    show(teamWith({ questions: [] }, leader, gamePanel('figures')))
    const band = container.querySelector<HTMLElement>('[data-testid="team-scene-band"]')
    expect(band).not.toBeNull()
    expect(getComputedStyle(band!).height).toBe('128px')
    expect(container.querySelectorAll('[data-testid="team-scene-actor"]')).toHaveLength(6)
    const tabs = container.querySelector('[role="tablist"]')!
    expect(band!.compareDocumentPosition(tabs) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('shows the readable band, names in place of art, when the style is Pixel', () => {
    show(teamWith({ questions: [] }, leader, gamePanel('pixel')))
    const band = container.querySelector<HTMLElement>('[data-testid="team-scene-band"]')
    expect(getComputedStyle(band!).height).toBe('128px')
    expect(container.querySelectorAll('[data-testid="team-scene-actor"]')).toHaveLength(0)
    const names = [...band!.querySelectorAll('div')]
      .filter((one) => one.childElementCount === 0)
      .map((one) => one.textContent)
    expect(names).toEqual(expect.arrayContaining(['Castillo', 'Juno', 'Rho']))
  })

  it('draws no band when the desktop panel is not in the Game look', () => {
    show(teamWith({ questions: [] }, leader, gamePanel('figures', 'plain')))
    expect(container.querySelector('[data-testid="team-scene-band"]')).toBeNull()
  })

  it('takes a waiting card to the Inbox in one tap', () => {
    show(teamWith())
    act(() => button('Team').click())
    act(() => button('Answer in Inbox').click())
    expect(button('Inbox').getAttribute('aria-selected')).toBe('true')
  })

  it("lands a switched tab at its top, not at the last tab's scroll", () => {
    show(teamWith())
    act(() => button('Team').click())
    const scroller = (): Element | null | undefined =>
      document.body.querySelector('[role="tablist"]')?.parentElement?.parentElement
    const teamScroller = scroller()
    act(() => button('Answer in Inbox').click())
    expect(teamScroller?.isConnected).toBe(false)
    expect(scroller()).not.toBeNull()
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

  it("words the Inbox tab in the host's language", () => {
    const team = teamWith()
    show({ ...team, view: team.view && { ...team.view, locale: 'es' } })
    const shown = texts()
    expect(shown).toContain('Para ti (1)')
    expect(shown).toContain('Esperando al lead (1)')
    expect(shown).toContain('Decisión')
    expect(shown).toContain('Hilos (1)')
    expect(shown).toContain('Respondidas (1)')
    expect(shown).toContain('Enviar')
    expect(button('Enviar respuesta')).toBeDefined()
    act(() => button('Abrir el hilo de ORCA-1, 2 mensajes').click())
    expect(button('Cerrar el hilo de ORCA-1, 2 mensajes')).toBeDefined()
  })

  // Why: a 44 pt minimum height left a dead band under every PR line; the touch area is hitSlop now.
  it('keeps the PR line its own height, so the card ends as it starts', () => {
    show(teamWith({ questions: [] }))
    expect(getComputedStyle(button('Open PR 850, CI green')).minHeight).not.toBe('44px')
  })

  // Why: the owner read the red left edge as decoration; the red waiting line already says it.
  it('marks a waiting card by its line, with no coloured left edge', () => {
    show(teamWith())
    act(() => button('Team').click())
    expect(texts()).toContain('Waiting for your answer')
    const edged = [...document.body.querySelectorAll<HTMLElement>('div')].filter(
      (one) => getComputedStyle(one).borderLeftWidth === '3px'
    )
    expect(edged).toEqual([])
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

  // Why: a Modal only appears once open, so the peek could not be dragged up into it.
  it("slides the open sheet in the session's own tree, not a separate window", () => {
    show(teamWith())
    expect(container.querySelector('[role="tablist"]')).not.toBeNull()
    expect(container.contains(button('Close Team, 1 needs you'))).toBe(true)
  })

  it('closes on a tap above the open sheet', () => {
    const onOpenChange = show(teamWith())
    const above = container.querySelector<HTMLElement>('[data-testid="team-sheet-above"]')
    act(() => above?.click())
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('closes on the Android back button while open, and leaves it alone while closed', () => {
    const handlers: (() => boolean)[] = []
    const listen = vi
      .spyOn(BackHandler, 'addEventListener')
      .mockImplementation((_event, handler) => {
        handlers.push(handler as () => boolean)
        return { remove: () => handlers.splice(handlers.indexOf(handler as () => boolean), 1) }
      })
    const onOpenChange = render(teamWith(), false)
    expect(handlers).toHaveLength(0)
    show(teamWith(), onOpenChange)
    expect(handlers).toHaveLength(1)
    let handled = false
    act(() => {
      handled = handlers[0]!()
    })
    expect(handled).toBe(true)
    expect(onOpenChange).toHaveBeenCalledWith(false)
    listen.mockRestore()
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
