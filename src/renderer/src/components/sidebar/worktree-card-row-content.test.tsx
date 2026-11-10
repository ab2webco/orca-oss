// @vitest-environment happy-dom

import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { WorktreeCardController } from './use-worktree-card-controller'
import type { WorktreeCardPresentation } from './worktree-card-presentation'

vi.mock('@/i18n/i18n', () => ({
  translate: (_key: string, fallback: string, options?: Record<string, unknown>) =>
    fallback.replace(/\{\{(\w+)\}\}/g, (_, name: string) => String(options?.[name] ?? '')),
  getIntlLocale: () => 'en'
}))
vi.mock('./worktree-card-parent-content', () => ({
  WorktreeCardParentContent: () => <div data-classic-card-content="" />
}))
const appState: {
  worktreeCardProperties: string[]
  agentStatusByPaneKey: Record<string, { stateStartedAt: number }>
} = { worktreeCardProperties: ['pr'], agentStatusByPaneKey: {} }
vi.mock('@/store', () => ({
  useAppStore: (selector: (state: typeof appState) => unknown) => selector(appState)
}))

const { WorktreeCardRowContent, WorktreeCardTeamChildren } =
  await import('./worktree-card-row-content')
const { TooltipProvider } = await import('@/components/ui/tooltip')
const { useSidebarTeamRosterStore, useSidebarTeamCard } = await import('./sidebar-team-roster')

const roots: ReturnType<typeof createRoot>[] = []
afterEach(async () => {
  await act(async () => {
    for (const root of roots.splice(0)) {
      root.unmount()
    }
  })
  useSidebarTeamRosterStore.setState({ model: null, look: 'game' })
  appState.agentStatusByPaneKey = {}
})

function cardOf(
  worktreeId: string,
  extra: Partial<WorktreeCardController> = {}
): WorktreeCardController {
  return {
    worktree: { id: worktreeId },
    newCardStyle: false,
    lineageChildren: null,
    lineageCollapsed: false,
    showLineageChildChip: false,
    ...extra
  } as unknown as WorktreeCardController
}

// Mirrors WorktreeCardSurface: the row and its child flag come from useSidebarTeamCard, and a
// team card's members follow its row.
function TeamCardContent({ card }: { card: WorktreeCardController }): React.JSX.Element {
  const team = useSidebarTeamCard(card.worktree.id)
  return (
    <>
      <WorktreeCardRowContent
        card={card}
        row={team.row}
        child={team.child}
        presentation={{} as WorktreeCardPresentation}
      />
      {team.row ? <WorktreeCardTeamChildren card={card} /> : null}
    </>
  )
}

function contentOf(card: WorktreeCardController): React.JSX.Element {
  return <TeamCardContent card={card} />
}

async function render(card: WorktreeCardController): Promise<HTMLElement> {
  const host = document.createElement('div')
  const root = createRoot(host)
  roots.push(root)
  await act(async () => root.render(<TooltipProvider>{contentOf(card)}</TooltipProvider>))
  return host
}

const lead = {
  paneKey: 'p-lead',
  terminalHandle: 'term-lead',
  worktreeId: 'wt-main',
  host: { kind: 'local' as const },
  name: 'Castle',
  agentType: 'claude',
  status: 'working' as const,
  condition: 'working' as const,
  since: null,
  liveAction: null,
  model: null,
  account: null,
  characterKey: null,
  branch: 'main',
  ownerAsk: null
}

describe('WorktreeCardRowContent', () => {
  it('keeps the classic card for a worktree outside the team', async () => {
    useSidebarTeamRosterStore.setState({ model: { lead, members: [] } })
    const host = await render(cardOf('wt-other'))

    expect(host.querySelector('[data-classic-card-content]')).not.toBeNull()
    expect(host.querySelector('[data-sidebar-team-row]')).toBeNull()
  })

  it("draws V30's lead row for the lead's worktree, with its members below", async () => {
    useSidebarTeamRosterStore.setState({ model: { lead, members: [] } })
    const host = await render(cardOf('wt-main', { lineageChildren: <div data-member-child="" /> }))

    expect(host.querySelector('[data-sidebar-team-row="lead"]')).not.toBeNull()
    expect(host.querySelector('[data-classic-card-content]')).toBeNull()
    expect(host.querySelector('[data-member-child]')).not.toBeNull()
  })

  it('keeps the show-children control only while the lead is collapsed', async () => {
    useSidebarTeamRosterStore.setState({ model: { lead, members: [] } })
    const expanded = await render(cardOf('wt-main', { showLineageChildChip: true }))
    expect(expanded.querySelector('[aria-expanded]')).toBeNull()

    const collapsed = await render(
      cardOf('wt-main', { showLineageChildChip: true, lineageCollapsed: true })
    )
    expect(collapsed.querySelector('[aria-expanded="false"]')).not.toBeNull()
  })

  it("gives the lead its own pane's age when game.state sends no stateSince", async () => {
    useSidebarTeamRosterStore.setState({ model: { lead, members: [] } })
    appState.agentStatusByPaneKey = { 'p-lead': { stateStartedAt: Date.now() - 2 * 3_600_000 } }
    const host = await render(cardOf('wt-main'))

    expect(host.querySelector('[data-team-row-part="age"]')!.textContent).toBe('2 h')
  })

  it('draws the members inside the lead as child rows', async () => {
    const squire = {
      ...lead,
      paneKey: 'p-m',
      worktreeId: 'wt-m',
      name: 'Squire',
      ticket: { identifier: 'ORCA-1', title: null, url: null, statusGroup: null },
      flowPhase: null,
      summary: null,
      pr: null,
      needsYou: false,
      limitResetsAt: null,
      found: false
    }
    useSidebarTeamRosterStore.setState({ model: { lead, members: [squire] } })
    const host = await render(cardOf('wt-main', { lineageChildren: contentOf(cardOf('wt-m')) }))

    const children = host.querySelector('[data-sidebar-team-children]')!
    expect(
      children
        .querySelector('[data-sidebar-team-row="member"]')!
        .hasAttribute('data-team-row-child')
    ).toBe(true)
    expect(
      host.querySelector('[data-sidebar-team-row="lead"]')!.hasAttribute('data-team-row-child')
    ).toBe(false)
  })
})
