// @vitest-environment happy-dom

import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { WorktreeCardController } from './use-worktree-card-controller'

const team = vi.hoisted(() => ({ value: { row: null as unknown, child: false } }))
const hover = vi.hoisted(() => ({
  details: false,
  title: undefined as string | undefined,
  branch: undefined as string | undefined
}))
const live = vi.hoisted(() => ({ agents: [] as unknown[] }))
vi.mock('./worktree-agent-row-selectors', () => ({
  selectLiveAgentStatusEntriesForWorktree: () =>
    live.agents.map((row) => (row as { entry: unknown }).entry)
}))
vi.mock('./useWorktreeAgentRows', () => ({ useWorktreeAgentRows: () => live.agents }))
vi.mock('./sidebar-team-roster', () => ({ useSidebarTeamCard: () => team.value }))
vi.mock('./worktree-card-row-content', () => ({
  WorktreeCardRowContent: ({ solo }: { solo?: unknown }) => (
    <div data-row-content="" data-solo={solo ? '' : undefined} />
  ),
  WorktreeCardTeamChildren: () => <div data-team-children="" />
}))
vi.mock('./worktree-card-presentation', () => ({
  buildWorktreeCardPresentation: () => ({
    titleOnlyCard: false,
    hasHoverDetails: hover.details,
    hoverWorkspaceTitle: hover.title,
    hoverBranchName: hover.branch
  })
}))
vi.mock('./WorktreeContextMenu', () => ({
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>
}))
vi.mock('./AutoRenameFailedDialog', () => ({ AutoRenameFailedDialog: () => null }))
vi.mock('./WorktreeCardMeta', () => ({
  WorktreeCardDetailsHover: ({
    children,
    detailsBefore,
    workspaceTitle,
    branchName
  }: {
    children: React.ReactNode
    detailsBefore?: React.ReactNode
    workspaceTitle?: string
    branchName?: string
  }) => (
    <div data-details-hover="" data-workspace-title={workspaceTitle} data-branch={branchName}>
      {detailsBefore ? <div data-details-before="">{detailsBefore}</div> : null}
      {children}
    </div>
  )
}))
type SoloOpen = Partial<Record<'pr' | 'ticket', (event: React.MouseEvent) => void>>
const soloHover = vi.hoisted(() => ({ onOpen: undefined as SoloOpen | undefined }))
vi.mock('./SidebarSoloHoverContent', () => ({
  SidebarSoloHoverContent: ({ paneKey, onOpen }: { paneKey: string; onOpen?: SoloOpen }) => {
    soloHover.onOpen = onOpen
    return <div data-solo-facts={paneKey} />
  }
}))
vi.mock('./WorktreeCardPorts', () => ({ WorktreeCardPortsDetails: () => null }))
vi.mock('./WorktreeCardAgentHoverDetails', () => ({ WorktreeCardAgentHoverDetails: () => null }))
vi.mock('./SidebarTeamHoverCard', () => ({
  SidebarTeamHoverCard: ({ children }: { children: React.ReactNode }) => (
    <div data-team-hover="">{children}</div>
  )
}))

const { WorktreeCardSurface } = await import('./worktree-card-surface')

const roots: ReturnType<typeof createRoot>[] = []
afterEach(async () => {
  await act(async () => {
    for (const root of roots.splice(0)) {
      root.unmount()
    }
  })
  team.value = { row: null, child: false }
  hover.details = false
  hover.title = undefined
  hover.branch = undefined
  live.agents = []
  soloHover.onOpen = undefined
})

const oneAgent = {
  paneKey: 'tab-1:leaf-1',
  entry: { state: 'working', paneKey: 'tab-1:leaf-1' },
  tab: { id: 'tab-1' },
  rowSource: 'live'
}

function cardOf(extra: Partial<WorktreeCardController>): WorktreeCardController {
  return {
    worktree: { id: 'wt-lead' },
    selectedWorktrees: [],
    isActive: false,
    isActiveSurface: false,
    activeSurfaceVariant: 'primary',
    isMultiSelected: false,
    workspacePorts: [],
    ...extra
  } as unknown as WorktreeCardController
}

async function surfaceOf(card: WorktreeCardController): Promise<HTMLElement> {
  const host = document.createElement('div')
  const root = createRoot(host)
  roots.push(root)
  await act(async () => root.render(<WorktreeCardSurface card={card} />))
  return host.querySelector<HTMLElement>('[data-worktree-card-surface]')!
}

const leadRow = { role: 'lead', card: {} }

describe('WorktreeCardSurface', () => {
  // Why: a classic card with an open child still reads as the active group.
  it('draws a classic parent active while its child is open', async () => {
    const surface = await surfaceOf(cardOf({ isActiveSurface: true }))

    expect(surface.getAttribute('data-worktree-card-active')).toBe('primary')
  })

  // ORCA-1148: V30 marks only the open member's row; the lead's card wraps it and stays plain.
  it("leaves the lead's team card unselected while one of its members is open", async () => {
    team.value = { row: leadRow, child: false }
    const surface = await surfaceOf(cardOf({ isActiveSurface: true }))

    expect(surface.hasAttribute('data-worktree-card-active')).toBe(false)
    expect(surface.hasAttribute('data-worktree-card-team')).toBe(true)
  })

  it("marks the lead's team card when the lead itself is open", async () => {
    team.value = { row: leadRow, child: false }
    const surface = await surfaceOf(cardOf({ isActive: true, isActiveSurface: true }))

    expect(surface.getAttribute('data-worktree-card-active')).toBe('primary')
  })

  // Why: hovering a member row must not light the lead's card around it.
  it('gives a team card no card hover of its own', async () => {
    team.value = { row: leadRow, child: false }
    const surface = await surfaceOf(cardOf({}))

    expect(surface.className).not.toContain('worktree-sidebar-card-hover')
  })

  // Why: the lead's hover card must not open when the pointer is on one of its members' rows.
  it("draws the lead's member rows outside the lead's hover trigger", async () => {
    team.value = { row: leadRow, child: false }
    hover.details = true
    const surface = await surfaceOf(cardOf({}))

    const children = surface.querySelector('[data-team-children]')
    expect(children).not.toBeNull()
    expect(children!.closest('[data-team-hover]')).toBeNull()
    expect(surface.querySelector('[data-team-hover] [data-row-content]')).not.toBeNull()
  })

  // ORCA-1149 S7: a team row opens its agent's card, never the worktree's details card.
  it("gives a team row its agent's hover card in place of the worktree details", async () => {
    team.value = { row: leadRow, child: false }
    hover.details = true
    const surface = await surfaceOf(cardOf({}))

    expect(surface.querySelector('[data-details-hover]')).toBeNull()
    expect(surface.querySelector('[data-team-hover]')).not.toBeNull()
  })

  it('keeps the worktree details card on a card with no team row', async () => {
    hover.details = true
    const surface = await surfaceOf(cardOf({}))

    expect(surface.querySelector('[data-team-hover]')).toBeNull()
    expect(surface.querySelector('[data-details-hover] [data-row-content]')).not.toBeNull()
  })

  // ORCA-1149 S9: one live agent draws V30's solo row.
  it('passes the one live agent to the row content as a solo row', async () => {
    live.agents = [oneAgent]
    const surface = await surfaceOf(cardOf({}))

    expect(surface.querySelector('[data-row-content]')!.hasAttribute('data-solo')).toBe(true)
  })

  // Why: the classic card's header holds the reconnect control a disconnected host needs.
  it('keeps the classic card for one agent on a disconnected SSH host', async () => {
    live.agents = [oneAgent]
    const surface = await surfaceOf(cardOf({ isSshDisconnected: true }))

    expect(surface.querySelector('[data-row-content]')!.hasAttribute('data-solo')).toBe(false)
  })

  it('keeps the classic card for one agent on a disconnected runtime', async () => {
    live.agents = [oneAgent]
    const surface = await surfaceOf(cardOf({ isRuntimeDisconnected: true }))

    expect(surface.querySelector('[data-row-content]')!.hasAttribute('data-solo')).toBe(false)
  })

  // ORCA-1149 S7: V30's solo facts lead the card, and every classic hover action stays below them.
  it("leads a solo row's details card with V30's agent facts, even with no other details", async () => {
    live.agents = [oneAgent]
    const surface = await surfaceOf(cardOf({}))

    expect(
      surface.querySelector('[data-details-hover] [data-details-before] [data-solo-facts]')
    ).not.toBeNull()
    expect(surface.querySelector('[data-solo-facts]')!.getAttribute('data-solo-facts')).toBe(
      'tab-1:leaf-1'
    )
    expect(surface.querySelector('[data-details-hover] [data-row-content]')).not.toBeNull()
  })

  it("drops the workspace title that repeats the solo facts' title, keeping a branch that differs", async () => {
    hover.title = 'master'
    hover.branch = 'fabolivark/orca-1149'
    live.agents = [oneAgent]
    const card = (await surfaceOf(cardOf({}))).querySelector('[data-details-hover]')!

    expect(card.hasAttribute('data-workspace-title')).toBe(false)
    expect(card.getAttribute('data-branch')).toBe('fabolivark/orca-1149')
  })

  it('keeps the workspace title on a card that is not a solo row', async () => {
    hover.details = true
    hover.title = 'master'
    const card = (await surfaceOf(cardOf({}))).querySelector('[data-details-hover]')!

    expect(card.getAttribute('data-workspace-title')).toBe('master')
  })

  it('opens no solo card while the Activity view shows the same facts', async () => {
    live.agents = [oneAgent]
    const surface = await surfaceOf(cardOf({ activityViewOpen: true }))

    expect(surface.querySelector('[data-details-hover]')).toBeNull()
  })

  it('adds no agent facts to a card that is not a solo row', async () => {
    hover.details = true
    const surface = await surfaceOf(cardOf({}))

    expect(surface.querySelector('[data-solo-facts]')).toBeNull()
  })

  it('closes the card and opens the PR and the ticket in Orca from their lines', async () => {
    live.agents = [oneAgent]
    const closeHover = vi.fn()
    const openReview = vi.fn()
    const openPlane = vi.fn()
    await surfaceOf(
      cardOf({
        worktree: { id: 'wt-lead', linkedPlaneWorkItem: { identifier: 'ORCA-1149' } },
        planeWorkItem: { identifier: 'ORCA-1149' },
        hoverReview: { provider: 'github', url: 'https://example.test/pr/1' },
        detailsHoverControl: { closeHover },
        handleOpenReviewInOrca: openReview,
        handleOpenPlaneWorkItemInOrca: openPlane
      } as unknown as Partial<WorktreeCardController>)
    )
    const event = {} as React.MouseEvent
    soloHover.onOpen?.pr?.(event)
    soloHover.onOpen?.ticket?.(event)

    expect(openReview).toHaveBeenCalledWith(event)
    expect(openPlane).toHaveBeenCalledWith(event)
    expect(closeHover).toHaveBeenCalledTimes(2)
  })
})
