// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { DashboardAgentRow } from '@/components/dashboard/useDashboardData'
import type { WorktreeCardController } from './use-worktree-card-controller'
import { WorktreeCardSoloContent } from './worktree-card-solo-content'

vi.mock('@/i18n/i18n', () => ({
  translate: (_key: string, fallback: string) => fallback,
  getIntlLocale: () => 'en'
}))
vi.mock('@/store', () => ({
  useAppStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({
      worktreeCardProperties: ['inline-agents'],
      groupBy: 'repo',
      claudeAccountRoster: null
    })
}))
vi.mock('@/components/dashboard/useNow', () => ({ useNow: () => 0 }))
vi.mock('@/lib/claude-account-runtime-filter', () => ({
  canPinClaudeAccountToWorktree: () => false
}))
vi.mock('@/components/team-panel/team-panel-solo-sessions', () => ({
  teamSoloHostOf: () => ({ kind: 'local' })
}))
vi.mock('./worktree-agent-row-actions', () => ({
  activateWorktreeAgentTab: vi.fn(),
  dismissWorktreeAgent: vi.fn(),
  useWorktreeAgentSendTargets: () => ({
    active: false,
    targetsByPaneKey: new Map(),
    onSendTargetClick: vi.fn()
  })
}))
vi.mock('./SidebarSoloRow', () => ({
  SidebarSoloRow: () => <div data-sidebar-solo-row="" role="treeitem" />
}))
vi.mock('./worktree-lineage-child-chip', () => ({
  WorktreeLineageChildChip: () => <button type="button" data-lineage-chip="" />
}))

const SOLO = {
  agent: {
    paneKey: 'tab-1:leaf-1',
    entry: {
      state: 'working',
      prompt: 'Add booking validation',
      updatedAt: 1,
      stateStartedAt: 1,
      paneKey: 'tab-1:leaf-1',
      stateHistory: []
    }
  } as unknown as DashboardAgentRow,
  subagents: 0
}

function cardOf(patch: Record<string, unknown> = {}): WorktreeCardController {
  return {
    worktree: { id: 'wt-1', path: '/repo/parent', displayName: 'E2E lineage parent' },
    repo: { id: 'repo-1', displayName: 'orca-oss' },
    workspacePorts: [],
    prDisplay: null,
    underHostHeader: false,
    newCardStyle: false,
    lineageChildren: null,
    lineageCollapsed: false,
    showLineageChildChip: false,
    lineageChildAriaLabel: 'Hide 1 child workspace',
    childWorkspaceShortLabel: '1',
    onLineageToggle: undefined,
    ...patch
  } as unknown as WorktreeCardController
}

let root: Root | null = null
let host: HTMLDivElement | null = null

function render(card: WorktreeCardController): HTMLDivElement {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  act(() => root?.render(<WorktreeCardSoloContent card={card} solo={SOLO} />))
  return host
}

afterEach(() => {
  act(() => root?.unmount())
  host?.remove()
  root = null
  host = null
})

describe('WorktreeCardSoloContent', () => {
  it('names its tree after the worktree, so the sidebar option is not read as "Agents"', () => {
    const tree = render(cardOf()).querySelector('[role="tree"]')
    expect(tree?.getAttribute('aria-label')).toBe('E2E lineage parent')
  })

  it('keeps the child workspaces and their show/hide control, as the classic card does', () => {
    const el = render(
      cardOf({ showLineageChildChip: true, lineageChildren: <div data-child-workspace="" /> })
    )
    expect(el.querySelector('[data-lineage-chip]')).not.toBeNull()
    expect(el.querySelector('[data-child-workspace]')).not.toBeNull()
    // Why outside the tree: a child workspace is a sidebar row of its own, not one of this agent's.
    expect(el.querySelector('[role="tree"] [data-child-workspace]')).toBeNull()
  })

  it('leaves the children to the card surface in the new card style', () => {
    const el = render(
      cardOf({
        newCardStyle: true,
        showLineageChildChip: true,
        lineageChildren: <div data-child-workspace="" />
      })
    )
    expect(el.querySelector('[data-lineage-chip]')).not.toBeNull()
    expect(el.querySelector('[data-child-workspace]')).toBeNull()
  })
})
