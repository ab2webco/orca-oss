// @vitest-environment happy-dom

import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { TeamLeadCard, TeamMemberCard } from '../../../../shared/team-panel-model-types'
import type { WorktreeCardController } from './use-worktree-card-controller'
import type { WorktreeCardPresentation } from './worktree-card-presentation'
import type { DeliveredMember } from './sidebar-delivered-members'

vi.mock('@/i18n/i18n', () => ({
  translate: (_key: string, fallback: string, options?: Record<string, unknown>) =>
    fallback.replace(/\{\{(\w+)\}\}/g, (_, name: string) => String(options?.[name] ?? '')),
  getIntlLocale: () => 'en'
}))
vi.mock('./worktree-card-parent-content', () => ({
  WorktreeCardParentContent: () => <div data-classic-card-content="" />
}))
const appState = { worktreeCardProperties: ['pr'], agentStatusByPaneKey: {} }
vi.mock('@/store', () => ({
  useAppStore: (selector: (state: typeof appState) => unknown) => selector(appState)
}))

const { WorktreeCardRowContent, WorktreeCardTeamChildren } =
  await import('./worktree-card-row-content')
const { useSidebarTeamRosterStore, useSidebarTeamCard } = await import('./sidebar-team-roster')
const { useSidebarDeliveredStore } = await import('./sidebar-delivered-store')
const { useSidebarDeliveredView } = await import('./use-sidebar-delivered-view')

const HOUR = 3_600_000
const roots: ReturnType<typeof createRoot>[] = []
afterEach(async () => {
  await act(async () => {
    for (const root of roots.splice(0)) {
      root.unmount()
    }
  })
  useSidebarTeamRosterStore.setState({ model: null, look: 'game' })
  useSidebarDeliveredStore.setState({
    delivered: {},
    history: [],
    projectName: null,
    queuedPrNumbers: new Set(),
    prKindByWorktreeId: {},
    foldedOpenByLead: {},
    collapsedByLead: {}
  })
})

const lead: TeamLeadCard = {
  paneKey: 'p-lead',
  terminalHandle: 'term-lead',
  worktreeId: 'wt-lead',
  host: { kind: 'local' },
  name: 'Alfred',
  agentType: 'claude',
  status: 'working',
  condition: 'working',
  since: null,
  liveAction: null,
  model: null,
  account: null,
  characterKey: null,
  branch: 'main',
  ownerAsk: null
}

const luigi: TeamMemberCard = {
  ...lead,
  paneKey: 'p-live',
  worktreeId: 'wt-live',
  name: 'Luigi',
  ticket: { identifier: 'ORCA-1199', title: null, url: null, statusGroup: null },
  flowPhase: null,
  summary: null,
  pr: null,
  needsYou: false,
  limitResetsAt: null,
  found: false
}

function delivered(worktreeId: string, hoursAgo: number, pr: string | null): DeliveredMember {
  const match = pr?.match(/^#(\d+) (\w+)$/)
  return {
    worktreeId,
    ticket: worktreeId.replace('wt-', 'ORCA-'),
    branch: `fabolivark/${worktreeId}`,
    character: 'Peach',
    freedAt: Date.now() - hoursAgo * HOUR,
    recordedPr: match
      ? { number: Number(match[1]), state: match[2] as 'merged' | 'open' | 'closed' }
      : null
  }
}

type Review = { number: number; title: string; state: 'open' | 'merged'; status: string }

function cardOf(
  worktreeId: string,
  extra: Omit<Partial<WorktreeCardController>, 'prDisplay'> & { prDisplay?: Review } = {}
): WorktreeCardController {
  return {
    worktree: { id: worktreeId },
    newCardStyle: false,
    lineageChildren: null,
    lineageCollapsed: false,
    showLineageChildChip: false,
    prDisplay: null,
    workspacePorts: [],
    ...extra
  } as unknown as WorktreeCardController
}

// Mirrors WorktreeCardSurface: the team row, the delivered view and the lead's children.
function CardContent({ card }: { card: WorktreeCardController }): React.JSX.Element {
  const team = useSidebarTeamCard(card.worktree.id)
  const view = useSidebarDeliveredView(card.worktree.id, team.delivered, card.prDisplay)
  return (
    <div data-worktree-card={card.worktree.id}>
      <WorktreeCardRowContent
        card={card}
        row={team.row}
        child={team.child}
        delivered={view}
        presentation={{} as WorktreeCardPresentation}
      />
      {team.row ? <WorktreeCardTeamChildren card={card} /> : null}
    </div>
  )
}

/** As renderWorktreeItemRow wraps each lineage child. */
const childRow = (card: WorktreeCardController): React.JSX.Element => (
  <div key={card.worktree.id} data-worktree-id={card.worktree.id}>
    <CardContent card={card} />
  </div>
)

async function render(
  card: WorktreeCardController,
  onLeadClick?: () => void
): Promise<HTMLElement> {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  roots.push(root)
  // Why the wrapper: it stands in for the lead card's own click handler.
  await act(async () =>
    root.render(
      <div onClick={onLeadClick}>
        <CardContent card={card} />
      </div>
    )
  )
  return host
}

const text = (node: Element | null | undefined): string => node?.textContent?.trim() ?? ''

describe('a delivered row', () => {
  it('names the freed member by ticket, PR number and state, without its character', async () => {
    useSidebarTeamRosterStore.setState({ model: { lead, members: [] } })
    useSidebarDeliveredStore.setState({
      delivered: { 'wt-1203': delivered('wt-1203', 2, '#1208 merged') }
    })
    const host = await render(cardOf('wt-lead', { lineageChildren: [childRow(cardOf('wt-1203'))] }))

    const row = host.querySelector('[data-sidebar-team-row="delivered"]')!
    expect(row.hasAttribute('data-team-row-child')).toBe(true)
    expect(text(row.querySelector('[data-team-row-part="name"]'))).toBe('ORCA-1203')
    expect(text(row.querySelector('[data-team-row-part="age"]'))).toBe('2 h')
    const line = row.querySelector('[data-delivered-pr-line]')!
    expect(text(line)).toBe('#1208 · merged')
    expect(line.getAttribute('data-delivered-kind')).toBe('merged')
    expect(row.querySelector('[data-status-tone]')!.getAttribute('data-status-tone')).toBe(
      'success'
    )
    expect(row.querySelector('[data-delivered-icon]')!.getAttribute('data-delivered-icon')).toBe(
      'merge'
    )
    expect(row.textContent).not.toContain('Peach')
    expect(host.querySelector('[data-classic-card-content]')).toBeNull()
  })

  it("reads CI failing and the merge queue from the card's own review", async () => {
    useSidebarTeamRosterStore.setState({ model: { lead, members: [] } })
    useSidebarDeliveredStore.setState({
      delivered: {
        'wt-1198': delivered('wt-1198', 0.4, '#1205 open'),
        'wt-1195': delivered('wt-1195', 0.7, '#1206 open')
      },
      queuedPrNumbers: new Set([1206])
    })
    const failing = cardOf('wt-1198', {
      prDisplay: { number: 1205, title: 'Fix', state: 'open', status: 'failure' }
    })
    const queued = cardOf('wt-1195', {
      prDisplay: { number: 1206, title: 'Queue', state: 'open', status: 'pending' }
    })
    const host = await render(
      cardOf('wt-lead', { lineageChildren: [childRow(failing), childRow(queued)] })
    )

    const lineOf = (id: string) =>
      host.querySelector(`[data-worktree-id="${id}"] [data-delivered-pr-line]`)
    expect(text(lineOf('wt-1198'))).toBe('#1205 · CI failing')
    expect(lineOf('wt-1198')!.getAttribute('data-delivered-kind')).toBe('ciFailing')
    expect(
      host
        .querySelector('[data-worktree-id="wt-1198"] [data-status-tone]')!
        .getAttribute('data-status-tone')
    ).toBe('warning')
    expect(text(lineOf('wt-1195'))).toBe('#1206 · open · queued')
    expect(
      host
        .querySelector('[data-worktree-id="wt-1195"] [data-status-tone]')!
        .getAttribute('data-status-tone')
    ).toBe('idle')
  })

  it('keeps the classic card for a delivered worktree that is not under its lead', async () => {
    useSidebarTeamRosterStore.setState({ model: { lead, members: [] } })
    useSidebarDeliveredStore.setState({
      delivered: { 'wt-1203': delivered('wt-1203', 2, '#1208 merged') }
    })
    const host = await render(cardOf('wt-1203'))

    expect(host.querySelector('[data-classic-card-content]')).not.toBeNull()
    expect(host.querySelector('[data-sidebar-team-row]')).toBeNull()
  })
})

describe("the lead's Delivered group", () => {
  async function renderTeam(onLeadClick?: () => void): Promise<HTMLElement> {
    useSidebarTeamRosterStore.setState({ model: { lead, members: [luigi] } })
    useSidebarDeliveredStore.setState({
      delivered: {
        'wt-1203': delivered('wt-1203', 2, '#1208 merged'),
        'wt-1195': delivered('wt-1195', 0.5, '#1206 open'),
        'wt-1198': delivered('wt-1198', 40, '#1205 open'),
        'wt-1170': delivered('wt-1170', 30, '#1180 merged'),
        'wt-1166': delivered('wt-1166', 50, '#1176 merged')
      }
    })
    const children = [
      childRow(cardOf('wt-1170')),
      childRow(cardOf('wt-1203')),
      childRow(cardOf('wt-live')),
      childRow(
        cardOf('wt-1198', {
          prDisplay: { number: 1205, title: 'Fix', state: 'open', status: 'failure' }
        })
      ),
      childRow(cardOf('wt-1166')),
      childRow(cardOf('wt-1195'))
    ]
    return render(cardOf('wt-lead', { lineageChildren: children }), onLeadClick)
  }

  const order = (host: HTMLElement, scope: string): string[] =>
    [...host.querySelectorAll(`${scope} > [data-worktree-id]`)].map(
      (node) => node.getAttribute('data-worktree-id')!
    )

  it('lists live members first, then Delivered newest first, folding rows past 24 h', async () => {
    const host = await renderTeam()

    expect(order(host, '[data-sidebar-team-children]')).toEqual(['wt-live'])
    const header = host.querySelector('[data-sidebar-delivered-header]')!
    expect(text(header.querySelector('[data-delivered-label]'))).toBe('Delivered')
    // Every row the group lists, folded ones included.
    expect(text(header.querySelector('[data-delivered-count]'))).toBe('5')
    // The CI failure is 40 h old and still shows; the merged rows past 24 h fold.
    expect(order(host, '[data-delivered-slot="recent"]')).toEqual(['wt-1195', 'wt-1203', 'wt-1198'])
    expect(order(host, '[data-delivered-slot="folded"]')).toEqual(['wt-1170', 'wt-1166'])
    expect(text(host.querySelector('[data-sidebar-delivered-folded-toggle]'))).toBe(
      '2 delivered · over 24 h'
    )
  })

  it('counts the folded rows in the header when every row is past 24 h', async () => {
    useSidebarTeamRosterStore.setState({ model: { lead, members: [] } })
    useSidebarDeliveredStore.setState({
      delivered: { 'wt-1170': delivered('wt-1170', 30, '#1180 merged') }
    })
    const host = await render(cardOf('wt-lead', { lineageChildren: [childRow(cardOf('wt-1170'))] }))

    expect(text(host.querySelector('[data-delivered-count]'))).toBe('1')
    expect(text(host.querySelector('[data-sidebar-delivered-folded-toggle]'))).toBe(
      '1 delivered · over 24 h'
    )
  })

  it('opens the count row in place and closes it again', async () => {
    const host = await renderTeam()
    const toggle = host.querySelector<HTMLButtonElement>('[data-sidebar-delivered-folded-toggle]')!
    const folded = () => [...host.querySelectorAll<HTMLElement>('[data-delivered-slot="folded"]')]
    expect(folded().map((one) => one.hidden)).toEqual([true, true])
    expect(toggle.getAttribute('aria-expanded')).toBe('false')

    await act(async () => toggle.click())
    expect(folded().map((one) => one.hidden)).toEqual([false, false])
    expect(toggle.getAttribute('aria-expanded')).toBe('true')
    expect(folded().every((one) => one.hasAttribute('data-delivered-muted'))).toBe(true)

    await act(async () => toggle.click())
    expect(folded().map((one) => one.hidden)).toEqual([true, true])
  })

  it("does not reach the lead's card when the count row is clicked", async () => {
    const onLeadClick = vi.fn()
    const host = await renderTeam(onLeadClick)
    await act(async () =>
      host.querySelector<HTMLButtonElement>('[data-sidebar-delivered-folded-toggle]')!.click()
    )
    expect(onLeadClick).not.toHaveBeenCalled()
  })

  it('collapses the whole group from its header', async () => {
    const host = await renderTeam()
    const header = host.querySelector<HTMLButtonElement>('[data-sidebar-delivered-header]')!
    await act(async () => header.click())

    expect(header.getAttribute('aria-expanded')).toBe('false')
    expect(host.querySelector<HTMLElement>('[data-sidebar-delivered-body]')!.hidden).toBe(true)
  })

  it('draws no group for a lead with no freed member', async () => {
    useSidebarTeamRosterStore.setState({ model: { lead, members: [luigi] } })
    const host = await render(cardOf('wt-lead', { lineageChildren: [childRow(cardOf('wt-live'))] }))

    expect(host.querySelector('[data-sidebar-delivered-header]')).toBeNull()
    expect(order(host, '[data-sidebar-team-children]')).toEqual(['wt-live'])
  })
})
