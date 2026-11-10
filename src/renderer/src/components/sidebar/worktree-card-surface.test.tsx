// @vitest-environment happy-dom

import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { WorktreeCardController } from './use-worktree-card-controller'

const team = vi.hoisted(() => ({ value: { row: null as unknown, child: false } }))
vi.mock('./sidebar-team-roster', () => ({ useSidebarTeamCard: () => team.value }))
vi.mock('./worktree-card-row-content', () => ({
  WorktreeCardRowContent: () => <div data-row-content="" />
}))
vi.mock('./worktree-card-presentation', () => ({
  buildWorktreeCardPresentation: () => ({ titleOnlyCard: false, hasHoverDetails: false })
}))
vi.mock('./WorktreeContextMenu', () => ({
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>
}))
vi.mock('./AutoRenameFailedDialog', () => ({ AutoRenameFailedDialog: () => null }))
vi.mock('./WorktreeCardMeta', () => ({ WorktreeCardDetailsHover: () => null }))
vi.mock('./WorktreeCardPorts', () => ({ WorktreeCardPortsDetails: () => null }))
vi.mock('./WorktreeCardAgentHoverDetails', () => ({ WorktreeCardAgentHoverDetails: () => null }))

const { WorktreeCardSurface } = await import('./worktree-card-surface')

const roots: ReturnType<typeof createRoot>[] = []
afterEach(async () => {
  await act(async () => {
    for (const root of roots.splice(0)) {
      root.unmount()
    }
  })
  team.value = { row: null, child: false }
})

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
})
