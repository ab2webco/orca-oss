// @vitest-environment happy-dom

import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { TeamLeadCard, TeamPanelGameModel } from '../../../../shared/team-panel-model-types'
import { useTeamSceneHover } from '../team-scene/team-scene-hit'

vi.mock('@/i18n/i18n', () => ({
  translate: (_key: string, fallback: string) => fallback,
  getIntlLocale: () => 'en'
}))
vi.mock('./team-session-open', () => ({ openTeamSession: vi.fn(async () => {}) }))

const { TeamTabContent } = await import('./TeamTabContent')

const roots: ReturnType<typeof createRoot>[] = []
afterEach(async () => {
  await act(async () => {
    for (const root of roots.splice(0)) {
      root.unmount()
    }
  })
  document.body.innerHTML = ''
  useTeamSceneHover.getState().set(null)
})

const lead = {
  paneKey: 'tab-lead:leaf',
  terminalHandle: 'term-lead',
  worktreeId: 'wt-main',
  host: { kind: 'local' },
  name: 'Castle',
  status: 'working',
  condition: 'working',
  since: null,
  liveAction: null,
  model: null
} as unknown as TeamLeadCard

async function renderTeam(): Promise<HTMLElement> {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  roots.push(root)
  const advisor = {
    model: 'Opus 5.5',
    effort: 'high',
    pinned: { model: false, effort: false },
    line: 'jev',
    previous: null,
    calls: []
  }
  const model = { kind: 'team', lead, advisor, members: [], xp: null, stopped: null }
  await act(async () => {
    root.render(
      <TeamTabContent
        model={model as unknown as TeamPanelGameModel}
        look="game"
        selectTab={vi.fn()}
        now={0}
        onOpenTasks={vi.fn()}
      />
    )
  })
  return container
}

// Why (ORCA-1336): hovering the lead or advisor row must light its figure in Figures 3D.
describe('the lead and advisor rows in the Team list', () => {
  it('light the lead and the advisor on pointer enter, and let go on leave', async () => {
    const container = await renderTeam()
    const leadRow = container.querySelector<HTMLElement>('[data-team-card="lead"]')!
    const advisorRow = container.querySelector<HTMLElement>('[data-team-card="advisor"]')!
    expect(leadRow).not.toBeNull()
    expect(advisorRow).not.toBeNull()
    await act(async () => {
      // Why these: React builds enter and leave from pointerover and pointerout.
      leadRow.dispatchEvent(new MouseEvent('pointerover', { bubbles: true }))
    })
    expect(useTeamSceneHover.getState().key).toBe('lead')
    expect(leadRow.hasAttribute('data-team-card-lit')).toBe(true)
    // The lit row carries the bar in the ring's blue, not only the hover tint.
    expect(leadRow.outerHTML).toContain('shadow-[inset_3px_0_0_var(--status-info)]')
    await act(async () => {
      leadRow.dispatchEvent(
        new MouseEvent('pointerout', { bubbles: true, relatedTarget: document.body })
      )
    })
    expect(useTeamSceneHover.getState().key).toBeNull()
    expect(leadRow.outerHTML).not.toContain('shadow-[inset_3px_0_0_var(--status-info)]')
    await act(async () => {
      advisorRow.dispatchEvent(new MouseEvent('pointerover', { bubbles: true }))
    })
    expect(useTeamSceneHover.getState().key).toBe('advisor')
    expect(advisorRow.outerHTML).toContain('shadow-[inset_3px_0_0_var(--status-info)]')
  })
})
