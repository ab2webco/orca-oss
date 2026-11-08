// @vitest-environment happy-dom

import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type {
  TeamLeadCard,
  TeamMemberCard,
  TeamPanelGameModel
} from '../../../../shared/team-panel-model-types'
import type { TeamArcadeActions } from './TeamArcadeSection'
import { TeamTabContent } from './TeamTabContent'
import { TeamScenePainterContext } from '../team-scene/team-scene-painter-context'
import type { TeamScenePainter } from '../team-scene/team-scene-painter'
import { recordingContext } from '../team-scene/team-scene-recording-context'

vi.mock('@/i18n/i18n', () => ({
  translate: (_key: string, fallback: string, options?: Record<string, unknown>) =>
    fallback.replace(/\{\{(\w+)\}\}/g, (_, name: string) => String(options?.[name] ?? '')),
  getIntlLocale: () => 'en'
}))

const roots: ReturnType<typeof createRoot>[] = []

afterEach(async () => {
  await act(async () => {
    for (const root of roots.splice(0)) {
      root.unmount()
    }
  })
  document.body.innerHTML = ''
})

const NOW = Date.UTC(2026, 10, 6, 12, 0, 0)

const lead: TeamLeadCard = {
  paneKey: 'pane-lead',
  terminalHandle: 'term-lead',
  worktreeId: 'wt-main',
  host: { kind: 'local' },
  name: 'Castle',
  agentType: 'claude',
  status: 'working',
  condition: 'working',
  since: NOW - 60_000,
  liveAction: { kind: 'tool', tool: 'Bash', detail: 'gh pr checks 923' },
  model: { label: 'Opus 5.5', effort: 'high', source: 'session' },
  account: null,
  characterKey: 'hero',
  branch: 'main',
  ownerAsk: null
}

function member(overrides: Partial<TeamMemberCard>): TeamMemberCard {
  return {
    paneKey: 'pane-m',
    terminalHandle: 'term-m',
    worktreeId: 'wt-m',
    host: { kind: 'remote', name: 'imac', environmentId: 'env-1', reachable: true },
    name: 'Knight',
    agentType: 'claude',
    status: 'working',
    condition: 'working',
    since: NOW - 120_000,
    liveAction: { kind: 'tool', tool: 'Edit', detail: 'terminal-role.ts' },
    model: { label: 'Sonnet 5.5', effort: 'medium', source: 'launch' },
    account: { provider: 'claude', email: 'dev@example.test', usedPercent: 12 },
    characterKey: null,
    ticket: {
      identifier: 'ORCA-1044',
      title: 'Remote member keeps its role',
      url: null,
      statusGroup: null
    },
    flowPhase: 'code',
    summary: 'Fixing the Windows check',
    pr: {
      provider: 'github',
      number: 924,
      title: 'Remote member stays a member',
      url: 'https://example.test/pr/924',
      state: 'open',
      ci: 'failure',
      verdict: null,
      perfectMerge: null
    },
    needsYou: false,
    limitResetsAt: null,
    found: false,
    ...overrides
  }
}

function model(overrides: Partial<TeamPanelGameModel> = {}): TeamPanelGameModel {
  return {
    kind: 'team',
    repoId: 'repo-1',
    projectName: 'orca-oss',
    lead,
    advisor: null,
    members: [member({})],
    metrics: { kind: 'loading' },
    xp: null,
    arcade: null,
    stopped: null,
    actions: [],
    scene: { id: null, extensions: [] },
    inbox: { kind: 'loading' },
    prs: null,
    queue: null,
    machines: null,
    ...overrides
  }
}

async function render(
  value: TeamPanelGameModel,
  look: 'game' | 'display' | 'plain' = 'game',
  selectTab = vi.fn(),
  arcadeActions: TeamArcadeActions | null = null,
  openTasks = vi.fn(),
  painter: TeamScenePainter | null = null
) {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  roots.push(root)
  await act(async () => {
    root.render(
      <TeamScenePainterContext.Provider value={painter}>
        <TeamTabContent
          model={value}
          look={look}
          selectTab={selectTab}
          now={NOW}
          arcadeActions={arcadeActions}
          onOpenTasks={openTasks}
        />
      </TeamScenePainterContext.Provider>
    )
  })
  return { container, selectTab, openTasks }
}

const advisorOf = () => ({
  model: 'Opus 5.5',
  effort: 'medium',
  pinned: { model: false, effort: false },
  line: 'Watching #923',
  previous: null,
  calls: []
})

const leadCard = (container: HTMLElement): HTMLElement =>
  container.querySelector<HTMLElement>('[data-team-card="lead"]')!
const memberCards = (container: HTMLElement): HTMLElement[] => [
  ...container.querySelectorAll<HTMLElement>('[data-team-card="member"]')
]

describe('TeamTabContent', () => {
  it('draws the lead first with its crown, host, model and live action', async () => {
    const { container } = await render(model())
    const card = leadCard(container)

    expect(container.querySelector('[data-team-card]')).toBe(card)
    expect(card.textContent).toContain('Castle')
    expect(card.textContent).toContain('Lead')
    expect(card.querySelector('svg[data-crown]')).not.toBeNull()
    expect(card.textContent).toContain('local')
    // ORCA-1129: a command reads as every tool label does.
    expect(card.textContent).toContain('Bash · gh pr checks 923')
    expect(card.textContent).toContain('Opus 5.5 · high')
    expect(card.textContent).toContain('Coordinates 1 agent')
  })

  it('shows each member with ticket, host, live action, model, phase and age', async () => {
    const { container } = await render(model())
    const [card] = memberCards(container)

    expect(card.textContent).toContain('Knight')
    expect(card.textContent).toContain('ORCA-1044')
    expect(card.textContent).toContain('imac')
    expect(card.textContent).toContain('terminal-role.ts')
    expect(card.textContent).toContain('Sonnet 5.5 · medium')
    expect(card.textContent).toContain('Coding')
    expect(card.textContent).toContain('2 min')
    expect(card.textContent).not.toContain('ago')
  })

  it('says the lead waits on the user and on which ticket, never the question itself', async () => {
    const { container } = await render(
      model({ lead: { ...lead, status: 'attention', ownerAsk: { ticket: 'ORCA-14' } } })
    )
    const card = leadCard(container)
    expect(card.textContent).toContain('Waiting for you · Question on ORCA-14')
    expect(card.textContent).not.toContain('gh pr checks 923')
    expect(card.querySelector('[data-status-glyph]')?.getAttribute('data-status-glyph')).toBe(
      'question'
    )
  })

  it('gives way at narrow widths with the host first, never scrolls sideways, and wraps the meta line', async () => {
    const { container } = await render(model())
    for (const card of [leadCard(container), ...memberCards(container)]) {
      const name = card.querySelector('[data-team-name]')!
      const host = card.querySelector('[data-team-host]')!
      // Why basis-0: the host claims only what is left, so it gives way before the name does.
      expect(host.className).toContain('basis-0')
      expect(host.className).toContain('flex-1')
      expect(host.className).toContain('truncate')
      expect(host.className).toContain('min-w-0')
      // ORCA-1092 row 23: a name too long for the row truncates instead of pushing the row wider.
      expect(name.className).not.toContain('shrink-0')
      expect(name.className).toContain('min-w-0')
      expect(name.className).toContain('truncate')
      expect(name.nextElementSibling?.className).toContain('shrink-0')
      const meta = card.querySelector('[data-team-meta]')!
      expect(meta.className).toContain('flex-wrap')
      expect(meta.className).not.toContain('truncate')
    }
  })

  it('sets the model in mono, as V28 does', async () => {
    const { container } = await render(model())
    const [card] = memberCards(container)
    const mono = card.querySelector('[data-team-model]')!
    expect(mono.textContent).toBe('Sonnet 5.5 · medium')
    expect(mono.className).toContain('font-mono')
    expect(leadCard(container).querySelector('[data-team-model]')?.textContent).toBe(
      'Opus 5.5 · high'
    )
  })

  it('marks needs-you with a question and working with a spinner', async () => {
    const { container } = await render(
      model({
        members: [
          member({ paneKey: 'ask', status: 'attention', needsYou: true }),
          member({ paneKey: 'work' })
        ]
      })
    )
    const [ask, work] = memberCards(container)
    expect(ask.querySelector('[data-status-glyph]')?.getAttribute('data-status-glyph')).toBe(
      'question'
    )
    expect(work.querySelector('[data-status-glyph]')?.getAttribute('data-status-glyph')).toBe(
      'spinner'
    )
  })

  it("draws each card's face with the scene's own painter, only in the Game look", async () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(
      () => recordingContext().g as never
    )
    const portrait = vi.fn()
    const painter = {
      height: 1,
      headTop: () => 0,
      paint: vi.fn(),
      dispose: vi.fn(),
      portrait
    } satisfies TeamScenePainter
    const value = model({ advisor: advisorOf(), members: [member({ characterKey: 'merlin' })] })
    const { container } = await render(value, 'game', vi.fn(), null, vi.fn(), painter)

    expect(container.querySelectorAll('canvas[data-team-face]')).toHaveLength(3)
    expect(portrait.mock.calls.map(([, who]) => who)).toEqual([
      { role: 'lead', key: 'lead', characterKey: 'hero', name: 'Castle' },
      { role: 'advisor', key: 'advisor', characterKey: null, name: 'Wizard' },
      { role: 'member', key: 'pane-m', characterKey: 'merlin', name: 'Knight' }
    ])
    expect(portrait.mock.calls.every(([, , size]) => size === 38)).toBe(true)

    const plain = await render(value, 'plain', vi.fn(), null, vi.fn(), painter)
    expect(plain.container.querySelector('[data-team-face]')).toBeNull()
    const without = await render(value)
    expect(without.container.querySelector('[data-team-face]')).toBeNull()
    vi.restoreAllMocks()
  })

  it('names characters only in the Game look', async () => {
    const { container } = await render(model(), 'plain')

    expect(leadCard(container).textContent).not.toContain('Castle')
    expect(memberCards(container)[0].textContent).not.toContain('Knight')
    expect(memberCards(container)[0].textContent).toContain('ORCA-1044')
  })

  it('keeps the model order, which puts members who need the user first', async () => {
    const { container } = await render(
      model({
        members: [
          member({
            paneKey: 'a',
            ticket: null,
            name: 'First',
            needsYou: true,
            status: 'attention'
          }),
          member({ paneKey: 'b', ticket: null, name: 'Second' })
        ]
      })
    )

    expect(memberCards(container).map((card) => card.dataset.paneKey)).toEqual(['a', 'b'])
  })

  it('sends a member who needs the user to Inbox, where the question is in full', async () => {
    const { container, selectTab } = await render(
      model({
        members: [
          member({
            needsYou: true,
            status: 'attention',
            condition: 'waiting',
            liveAction: { kind: 'question', text: 'Merge #923 now?', options: ['Yes', 'No'] }
          })
        ]
      })
    )
    const button = [...container.querySelectorAll('button')].find(
      (node) => node.textContent === 'Answer in Inbox'
    )

    await act(async () => button?.click())
    expect(selectTab).toHaveBeenCalledWith('inbox')
  })

  // Why: the red tone says the member needs the user; a "Working" label under it contradicts it (V28).
  it('says a member needing the user waits for an answer, in the tone that shows it', async () => {
    const { container } = await render(
      model({ members: [member({ needsYou: true, status: 'attention' })] })
    )
    const card = memberCards(container)[0]
    const line = [...card.querySelectorAll('span')].findLast(
      (node) => node.textContent === 'Waiting for your answer'
    )

    expect(line?.className).toContain('text-status-attention')
    expect(card.textContent).not.toContain('Edit · terminal-role.ts')
  })

  // Why: a question appears in full only in Inbox (ORCA-1048).
  it('never prints the question on the card', async () => {
    const question = { kind: 'question' as const, text: 'Merge #14 now?', options: ['Yes'] }
    const { container } = await render(
      model({ members: [member({ needsYou: true, status: 'attention', liveAction: question })] })
    )

    expect(memberCards(container)[0].textContent).not.toContain('Merge #14 now?')
    expect(memberCards(container)[0].textContent).toContain('Waiting for your answer')
  })

  it('shows the ticket once when the member is named after it', async () => {
    const { container } = await render(model({ members: [member({ name: 'ORCA-1044' })] }), 'game')

    expect(memberCards(container)[0].textContent?.match(/ORCA-1044/g)).toHaveLength(1)
  })

  it('expands a member to show its summary, pull request and account', async () => {
    const { container } = await render(model())
    const toggle = memberCards(container)[0].querySelector<HTMLButtonElement>('[aria-expanded]')!

    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    expect(container.textContent).not.toContain('Fixing the Windows check')
    await act(async () => toggle.click())
    expect(toggle.getAttribute('aria-expanded')).toBe('true')
    expect(container.textContent).toContain('Fixing the Windows check')
    expect(container.textContent).toContain('#924')
    expect(container.textContent).toContain('Remote member keeps its role')
    expect(container.textContent).toContain('CI failing')
    const chip = container.querySelector('[data-team-pr-chip]')!
    expect(chip.querySelector('[data-status-tone]')?.getAttribute('data-status-tone')).toBe(
      'attention'
    )
    expect(container.textContent).toContain('dev@example.test · 12%')
  })

  it('shows the Advisor row under the lead only when the plugin reports one', async () => {
    const without = await render(model())
    expect(without.container.querySelector('[data-team-card="advisor"]')).toBeNull()

    const { container } = await render(
      model({
        advisor: {
          model: 'Opus 5.5',
          effort: 'medium',
          pinned: { model: false, effort: false },
          line: 'Approved Opus 5.5 · medium for ORCA-1044',
          previous: null,
          calls: []
        }
      })
    )
    const row = container.querySelector('[data-team-card="advisor"]')!
    expect(row.previousElementSibling).toBe(leadCard(container))
    expect(row.textContent).toContain('Approved Opus 5.5 · medium for ORCA-1044')
    expect(row.textContent).toContain('Wizard')
    // Why: V28's Advisor row has no model line; the model is already in the sentence.
    expect(row.querySelector('[data-team-model]')).toBeNull()

    const plain = await render(model({ advisor: { ...advisorOf() } }), 'plain')
    expect(plain.container.querySelector('[data-team-card="advisor"]')!.textContent).not.toContain(
      'Wizard'
    )
  })

  // Why none here: the level moved under the project name, above the tabs, as V28 draws it (ORCA-1094).
  it('leaves XP to the panel header, in either look', async () => {
    const xp = { level: 11, into: 240, need: 1100 }
    expect((await render(model({ xp }))).container.textContent).not.toContain('XP')
    expect((await render(model({ xp }), 'display')).container.textContent).not.toContain('XP')
  })

  it('says when the lead has no members yet', async () => {
    const { container } = await render(model({ members: [] }))

    expect(leadCard(container)).not.toBeNull()
    expect(container.textContent).toContain('No agents yet')
  })

  it("opens Orca's Tasks view from the empty state, as V28 does", async () => {
    const { container, openTasks } = await render(model({ members: [] }))
    const button = container.querySelector<HTMLButtonElement>('button[data-team-view-tasks]')

    expect(button?.textContent).toBe('View tasks')
    act(() => button?.click())
    expect(openTasks).toHaveBeenCalledTimes(1)
  })

  it('offers no Tasks button once the lead has members', async () => {
    const { container } = await render(model())

    expect(container.querySelector('button[data-team-view-tasks]')).toBeNull()
  })

  it('shows the project STOP', async () => {
    const { container } = await render(model({ stopped: { since: null, by: 'owner' } }))

    expect(container.textContent).toContain('Stopped')
  })

  describe('arcade', () => {
    const on = (): TeamArcadeActions => ({
      play: vi.fn(async () => {}),
      keep: vi.fn(async () => {})
    })
    const saved = { credits: 2, offerPr: 923 }
    const section = (container: HTMLElement): Element | null =>
      container.querySelector('[data-arcade-offer], [data-arcade-credits]')

    it('offers the saved play above the lead in the Game look', async () => {
      const { container } = await render(model({ arcade: saved }), 'game', vi.fn(), on())
      const offer = section(container)!

      expect(offer).not.toBeNull()
      expect(
        offer.compareDocumentPosition(leadCard(container)) & Node.DOCUMENT_POSITION_FOLLOWING
      ).toBeTruthy()
    })

    it.each(['display', 'plain'] as const)('hides the arcade in the %s look', async (look) => {
      const { container } = await render(model({ arcade: saved }), look, vi.fn(), on())
      expect(section(container)).toBeNull()
    })

    it('hides the arcade when it is off or the host cannot spend a play', async () => {
      const off = await render(model({ arcade: null }), 'game', vi.fn(), on())
      expect(section(off.container)).toBeNull()

      const noHost = await render(model({ arcade: saved }), 'game', vi.fn(), null)
      expect(section(noHost.container)).toBeNull()
    })
  })
})
