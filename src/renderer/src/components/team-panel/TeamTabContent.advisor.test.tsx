// @vitest-environment happy-dom

import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { TeamLeadCard, TeamPanelGameModel } from '../../../../shared/team-panel-model-types'

vi.mock('@/i18n/i18n', () => ({
  translate: (_key: string, fallback: string, options?: Record<string, unknown>) =>
    fallback.replace(/\{\{(\w+)\}\}/g, (_, name: string) => String(options?.[name] ?? '')),
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

const LINE = 'jev · mediría: Opus 5.5 · esfuerzo alto · piso de código (Jev: código)'

async function renderAdvisorLine(): Promise<HTMLElement> {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  roots.push(root)
  const advisor = {
    model: 'Opus 5.5',
    effort: 'high',
    pinned: { model: false, effort: false },
    line: LINE,
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
  return container.querySelector<HTMLElement>('[data-team-advisor-line]')!
}

// Why (ORCA-1173): a long Jev sentence must end in an ellipsis, never mid-word, and stay readable.
describe('the advisor card line', () => {
  it('shows two lines at most, with the whole sentence on hover', async () => {
    const line = await renderAdvisorLine()
    expect(line.textContent).toBe(LINE)
    expect(line.className).toContain('line-clamp-2')
    expect(line.getAttribute('title')).toBe(LINE)
    expect(line.getAttribute('aria-expanded')).toBe('false')
  })

  it('opens to the whole sentence on a tap, and folds back on another', async () => {
    const line = await renderAdvisorLine()
    await act(async () => line.click())
    expect(line.className).not.toContain('line-clamp-2')
    expect(line.getAttribute('aria-expanded')).toBe('true')
    await act(async () => line.click())
    expect(line.className).toContain('line-clamp-2')
  })
})
