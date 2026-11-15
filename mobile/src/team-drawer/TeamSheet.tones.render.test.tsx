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
import type { TeamDrawerData } from './team-drawer-model'
import { teamTonesOf } from './team-status-tone'
import { colors } from '../theme/mobile-theme'
import {
  button,
  gamePanel,
  leader,
  NOW,
  safeArea,
  teamWith,
  work
} from './team-sheet-render-fixtures'

describe("TeamSheet in the person's status colours from Settings > Agent Teams", () => {
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

  const render = (team: TeamDrawerData, open: boolean) =>
    act(() =>
      root.render(
        <SafeAreaProvider initialMetrics={safeArea}>
          <TeamSheet
            open={open}
            onOpenChange={vi.fn()}
            team={team}
            now={NOW}
            hostName="m1"
            onOpenLink={() => {}}
            onOpenTerminal={vi.fn()}
          />
        </SafeAreaProvider>
      )
    )
  const show = (team: TeamDrawerData) => render(team, true)

  const tones = teamTonesOf({
    attention: '#a10001',
    warning: '#a20002',
    info: '#a30003',
    success: '#a40004',
    idle: '#a50005'
  })
  const paint = (hex: string): string => {
    const n = Number.parseInt(hex.slice(1), 16)
    return `rgba(${n >> 16}, ${(n >> 8) & 255}, ${n & 255}, 1.00)`
  }
  const paints = (scope: Element): string[] =>
    [scope, ...scope.querySelectorAll('*')].flatMap((one) => {
      const style = getComputedStyle(one)
      return [style.backgroundColor, style.color]
    })
  // Why the parent: every status mark sits beside its words in one row.
  const lineOf = (text: string, scope: ParentNode = document.body): Element => {
    const leaf = [...scope.querySelectorAll('div')].find(
      (one) => one.childElementCount === 0 && one.textContent === text
    )
    if (!leaf?.parentElement) {
      throw new Error(`no line reading ${text}`)
    }
    return leaf.parentElement
  }

  it("draws today's colours when nothing is overridden", () => {
    render(teamWith(), false)
    expect(paints(button('Open Team, 1 needs you'))).toContain(paint(colors.statusRed))
    show(teamWith({ questions: [] }, leader))
    expect(paints(lineOf('Edit · terminal-role.ts'))).toContain(paint(colors.statusGreen))
  })

  it('marks the peek with who needs you, then who works', () => {
    render(teamWith({ tones }), false)
    const asking = paints(button('Open Team, 1 needs you'))
    expect(asking).toContain(paint(tones.attention))
    expect(asking).not.toContain(paint(colors.statusRed))
    render(teamWith({ questions: [], tones }), false)
    expect(paints(button('Open Team, 2 working · 4 members'))).toContain(paint(tones.info))
  })

  it("marks each member card and the lead's card by its state", () => {
    show(teamWith({ questions: [], tones }, leader))
    expect(paints(lineOf('Edit · terminal-role.ts'))).toContain(paint(tones.info))
    expect(paints(lineOf('Logged out'))).toContain(paint(tones.attention))
    const lead = paints(lineOf('Orchestrating · Read · ORCA-9'))
    expect(lead).toContain(paint(tones.info))
    expect(lead).not.toContain(paint(colors.statusGreen))
  })

  it('marks each PR row and each host by its status', () => {
    show(teamWith({ questions: [], tones }, null, work))
    act(() => button('PRs').click())
    expect(paints(button('#415 Rate limit dashboard, Check failed'))).toContain(
      paint(tones.attention)
    )
    act(() => button('Hosts').click())
    const imac = paints(lineOf('imac').parentElement!)
    expect(imac).toContain(paint(tones.warning))
    expect(imac).not.toContain(paint(colors.statusAmber))
    expect(imac).not.toContain(paint(colors.statusRed))
  })

  it("marks each name in the scene band by its member's state", () => {
    show(teamWith({ tones }, leader, gamePanel('pixel')))
    const band = container.querySelector('[data-testid="team-scene-band"]')!
    expect(paints(lineOf('Juno', band))).toContain(paint(tones.info))
    expect(paints(lineOf('Merlin', band))).toContain(paint(tones.attention))
    expect(paints(lineOf('Arthur', band))).toContain(paint(tones.idle))
  })

  it('marks the STOP above the lead dock as needing you', () => {
    show(teamWith({ questions: [], tones }, null, { stopped: { by: 'lead' } }))
    const title = [...document.body.querySelectorAll('*')].find(
      (one) => one.childElementCount === 0 && one.textContent === 'Stopped by lead'
    )!
    // Why two up: the title is nested in the banner's sentence, beside the dot.
    const marks = paints(title.parentElement!.parentElement!)
    expect(marks).toContain(paint(tones.attention))
    expect(marks).not.toContain(paint(colors.statusRed))
  })
})
