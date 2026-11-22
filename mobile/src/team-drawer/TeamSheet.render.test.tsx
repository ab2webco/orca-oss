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

type PageMessage = (event: { nativeEvent: { data: string } }) => void
const webview = vi.hoisted(() => ({
  onMessage: null as PageMessage | null,
  injected: [] as string[]
}))

// Why a stand-in: react-native-webview ships native source; the stage's page is tested on its own.
vi.mock('react-native-webview', async () => {
  const { forwardRef, useImperativeHandle, createElement: h } = await import('react')
  return {
    WebView: forwardRef((props: { onMessage: PageMessage }, ref) => {
      webview.onMessage = props.onMessage
      useImperativeHandle(ref, () => ({
        injectJavaScript: (js: string) => webview.injected.push(js)
      }))
      return h('div', { 'data-testid': 'team-scene-webview' })
    })
  }
})

import { getByGestureTestId } from 'react-native-gesture-handler/jest-utils'

/** The last run the page was told: each injection calls `window.__teamScene(message)`. */
const lastMotion = (): unknown =>
  webview.injected
    .map((js) => JSON.parse(js.match(/^window\.__teamScene\((.*)\);true;$/s)![1]!))
    .findLast((message: { kind: string }) => message.kind === 'motion')

import { gameHostLaunchOf } from '../../../src/shared/orchestrator-game-member-repo-scope'
import { TeamSheet } from './TeamSheet'
import type { TeamDrawerData } from './team-drawer-model'
import { colors, radii } from '../theme/mobile-theme'
import {
  ADVISOR_LINE,
  button,
  gamePanel,
  leader,
  NOW,
  safeArea,
  teamWith,
  texts,
  work
} from './team-sheet-render-fixtures'

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
    // Why the parent: the rounded surface fills the 84% sheet, which also holds the corner cover.
    const rounded = [...document.body.querySelectorAll<HTMLElement>('div')]
      .filter((one) => getComputedStyle(one).borderTopLeftRadius === '14px')
      .map((one) => getComputedStyle(one.parentElement!).height)
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
    expect(shown).toEqual(expect.arrayContaining(['Memory', '61%']))
    expect(shown).toContain('imac')
    expect(shown).toContain('Low memory · 1 agent')
    expect(shown).toContain('2 of 16 GB free')
    expect(shown).toContain('contabo')
    expect(shown).toContain('Offline')
    expect(shown).not.toContain('local')
  })

  // Why: a host the launch refuses must not read as free capacity (ORCA-1207).
  it('says which hosts cannot take this project and why, and never calls them free', () => {
    const idle = { status: 'ok' as const, running: 0, cpuCoreCount: 8, totalMemory: 32e9 }
    const refusal = 'orca-oss on m1 names github.com/stablyai/orca, the upstream every fork shares.'
    const hostCapacity = [
      ...work.hostCapacity!,
      {
        ...idle,
        host: 'koombea',
        availableMemory: 30e9,
        loadAverage1m: 1,
        launch: { kind: 'unregistered' as const, project: 'orca-oss', reason: 'x' }
      },
      {
        ...idle,
        host: 'orca-contabo',
        availableMemory: 30e9,
        loadAverage1m: 1,
        launch: { kind: 'refused' as const, reason: refusal }
      },
      { ...idle, host: 'older', availableMemory: 30e9, loadAverage1m: 1 }
    ]
    show(teamWith({ questions: [] }, null, { ...work, hostCapacity }))
    act(() => button('Hosts').click())
    const shown = texts()
    expect(shown).toContain('Not registered')
    expect(shown).toContain(
      "orca-oss is not registered here. With the owner's OK, clone and register it."
    )
    expect(shown).toContain('Refused')
    expect(shown).toContain(refusal)
    expect(shown).toContain('Unknown')
    expect(shown).not.toContain('Free')
  })

  it('shows in full why a partial clone with no remote identity cannot take members (ORCA-1250)', () => {
    const lead = {
      id: 'r',
      displayName: 'orca-oss',
      path: '/w',
      remoteKey: 'github.com/ab2webco/orca-oss'
    }
    const partial = { id: 'h', displayName: 'orca-oss', path: '/w', remoteKey: null }
    const launch = gameHostLaunchOf({ lead, host: 'koombea', repos: [partial] })
    const koombea = {
      host: 'koombea',
      status: 'ok' as const,
      running: 0,
      cpuCoreCount: 8,
      totalMemory: 32e9,
      availableMemory: 30e9,
      loadAverage1m: 1,
      launch
    }
    show(teamWith({ questions: [] }, null, { ...work, hostCapacity: [koombea] }))
    act(() => button('Hosts').click())
    expect(texts()).toContain(
      "orca-oss on koombea has no remote identity yet, so Orca cannot tell whether it is orca-oss's clone. See ORCA-1250."
    )
    expect(texts()).not.toContain('Free')
  })

  it('words the PRs and Hosts tabs in the host language', () => {
    const team = teamWith({ questions: [] }, null, work)
    show({ ...team, view: team.view && { ...team.view, locale: 'es' } })
    act(() => button('PRs').click())
    expect(texts()).toContain('Cola de merge')
    expect(texts()).toContain('Check falló')
    act(() => button('Hosts').click())
    expect(texts()).toContain('Poca memoria · 1 agente')
    expect(texts()).toContain('2 de 16 GB libres')
  })

  it('says an older host publishes no PRs or hosts, instead of an empty list', () => {
    show(teamWith({ questions: [] }))
    act(() => button('PRs').click())
    expect(texts()).toContain('This Orca host does not publish it yet.')
    act(() => button('Hosts').click())
    expect(texts()).toContain('This Orca host does not publish it yet.')
  })

  it("draws the desktop's live stage 176 pt tall above the tabs, in every Game style", () => {
    for (const style of ['figures', 'office', 'pixel']) {
      show(teamWith({ questions: [] }, leader, gamePanel(style)))
      const band = container.querySelector<HTMLElement>('[data-testid="team-scene-band"]')
      expect(getComputedStyle(band!).height).toBe('176px')
      expect(band!.querySelector('[data-testid="team-scene-webview"]')).not.toBeNull()
      const tabs = container.querySelector('[role="tablist"]')!
      expect(band!.compareDocumentPosition(tabs) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    }
  })

  it("lets a finger on the 3D stage move its camera ahead of the sheet's scroll and drag (ORCA-1335)", async () => {
    const panel = { panel: { ...gamePanel('figures').panel, diorama: true } }
    show(teamWith({ questions: [] }, leader, panel))
    const page = (event: unknown) =>
      act(() => webview.onMessage!({ nativeEvent: { data: JSON.stringify(event) } }))
    page({ kind: 'loaded' })
    page({ kind: 'ready', height: 240, camera: 'lead' })
    expect(button('Follow the lead')).toBeTruthy()
    // Why: RNGH registers an updated gesture in a microtask.
    await act(async () => {})
    const sheet = [
      getByGestureTestId('team-sheet-scroll'),
      getByGestureTestId('team-sheet-content-drag')
    ]
    for (const id of ['team-scene-camera-pan', 'team-scene-camera-pinch']) {
      const camera = getByGestureTestId(id)
      expect(camera.config.enabled).toBe(true)
      expect(camera.config.blocksHandlers).toEqual(sheet.map((one) => one.handlerTag))
    }
  })

  it('keeps the stage loaded but still at the peek, so an open draws it without a reload (ORCA-1309)', () => {
    webview.injected = []
    render(teamWith({ questions: [] }, leader, gamePanel('pixel')), false)
    const stage = container.querySelector('[data-testid="team-scene-webview"]')
    expect(stage).not.toBeNull()
    expect(stage!.closest('[aria-hidden="true"]')).not.toBeNull()
    expect(container.querySelector('[role="tablist"]')).toBeNull()
    act(() => webview.onMessage!({ nativeEvent: { data: JSON.stringify({ kind: 'loaded' }) } }))
    expect(lastMotion()).toMatchObject({ kind: 'motion', run: false })
    show(teamWith({ questions: [] }, leader, gamePanel('pixel')))
    expect(container.querySelector('[data-testid="team-scene-webview"]')).toBe(stage)
    expect(stage!.closest('[aria-hidden="true"]')).toBeNull()
    expect(lastMotion()).toMatchObject({ kind: 'motion', run: true })
  })

  it('shows the readable band, names in place of art, for a host that sends no panel', () => {
    show(teamWith({ questions: [] }, leader))
    const band = container.querySelector<HTMLElement>('[data-testid="team-scene-band"]')
    expect(band!.querySelector('[data-testid="team-scene-webview"]')).toBeNull()
    const names = [...band!.querySelectorAll('div')]
      .filter((one) => one.childElementCount === 0)
      .map((one) => one.textContent)
    expect(names).toEqual(expect.arrayContaining(['Castillo', 'Juno', 'Rho']))
  })

  it('covers the terminal behind its rounded top corners, so no glyph shows in the drag area', () => {
    show(teamWith({ questions: [] }, leader))
    const cover = container.querySelector<HTMLElement>('[data-testid="team-sheet-corners"]')
    expect(cover).not.toBeNull()
    const style = getComputedStyle(cover!)
    const n = Number.parseInt(colors.terminalBg.slice(1), 16)
    expect(style.backgroundColor).toBe(`rgba(${n >> 16}, ${(n >> 8) & 255}, ${n & 255}, 1.00)`)
    expect(style.height).toBe(`${radii.card}px`)
    expect(style.top).toBe('0px')
  })

  it('draws no band when the desktop panel is not in the Game look', () => {
    show(teamWith({ questions: [] }, leader, gamePanel('figures', 'plain')))
    expect(container.querySelector('[data-testid="team-scene-band"]')).toBeNull()
  })

  it('shows no dock without a lead terminal to send to', () => {
    show(teamWith({ questions: [], sendAction: null }))
    expect(document.body.querySelector('[aria-label="Stop every member"]')).toBeNull()
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
    scroller()!.scrollTop = 300
    act(() => button('Answer in Inbox').click())
    expect(button('Inbox').getAttribute('aria-selected')).toBe('true')
    expect(scroller()!.scrollTop).toBe(0)
  })

  it('keeps the stage mounted across tab switches, so it never reloads blank (ORCA-1307)', () => {
    show(teamWith({}, leader, gamePanel('figures')))
    const stage = container.querySelector('[data-testid="team-scene-webview"]')
    expect(stage).not.toBeNull()
    for (const tab of ['Team', 'Inbox', 'PRs', 'Hosts', 'Team']) {
      act(() => button(tab).click())
      expect(container.querySelector('[data-testid="team-scene-webview"]')).toBe(stage)
    }
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
