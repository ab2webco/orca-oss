// @vitest-environment happy-dom

import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type {
  TeamActivityRow,
  TeamPanelSoloModel,
  TeamStatus
} from '../../../../shared/team-panel-model-types'
import { TooltipProvider } from '@/components/ui/tooltip'
import { TeamPanelView } from './TeamPanelView'
import { useTeamPanelTabStore } from './team-panel-tab-store'

vi.mock('@/i18n/i18n', () => ({
  translate: (_key: string, fallback: string, options?: Record<string, unknown>) =>
    fallback.replace(/\{\{(\w+)\}\}/g, (_, name: string) => String(options?.[name] ?? ''))
}))

const roots: ReturnType<typeof createRoot>[] = []

afterEach(async () => {
  await act(async () => {
    for (const root of roots.splice(0)) {
      root.unmount()
    }
  })
  document.body.innerHTML = ''
  useTeamPanelTabStore.setState({ selected: null, shown: null })
})

const row = (paneKey: string, status: TeamStatus): TeamActivityRow => ({
  paneKey,
  terminalHandle: null,
  worktreeId: null,
  host: { kind: 'local' },
  name: paneKey,
  agentType: 'claude',
  status,
  condition: status === 'done' ? 'done' : status === 'attention' ? 'waiting' : 'working',
  since: null,
  liveAction: null,
  model: null,
  account: null,
  inTeam: false,
  repoName: 'orca-oss',
  worktreeName: paneKey,
  isPrimary: false,
  prompt: null,
  ticket: null,
  pr: null,
  lastMessage: null,
  cacheExpiresAt: null,
  ports: [],
  note: null,
  subagentCount: 0,
  recentSteps: [],
  advisor: null
})

const modelOf = (rows: TeamActivityRow[]): TeamPanelSoloModel => ({
  kind: 'solo',
  selectedPaneKey: null,
  rows,
  inbox: { kind: 'ready', value: { forYou: 0, waiting: 0, threads: 0, answered: 0 } },
  prs: null,
  queue: null,
  machines: null
})

const ROWS = [row('a', 'working'), row('b', 'done'), row('c', 'working'), row('d', 'attention')]

async function render(rows: TeamActivityRow[]) {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  roots.push(root)
  const draw = (next: TeamActivityRow[]) =>
    root.render(
      <TooltipProvider>
        <TeamPanelView
          source={{ section: { kind: 'ready', value: modelOf(next) }, retry: null }}
          look="plain"
          onOpenSettings={vi.fn()}
        />
      </TooltipProvider>
    )
  await act(async () => draw(rows))
  return { container, redraw: (next: TeamActivityRow[]) => act(async () => draw(next)) }
}

const listed = (container: HTMLElement): string[] =>
  [...container.querySelectorAll('[data-team-activity][data-pane-key]')].map(
    (one) => one.getAttribute('data-pane-key') ?? ''
  )
const countButton = (container: HTMLElement, status: TeamStatus): HTMLButtonElement =>
  container.querySelector<HTMLButtonElement>(`[data-team-activity-filter="${status}"]`)!
const click = (element: HTMLElement) => act(async () => element.click())

// Why: the owner clicked '4 working' and expected the list below to show only those.
describe('Your work counts filter the session list', () => {
  it('shows only the sessions of the count you pick, and every row again on a second click', async () => {
    const { container } = await render(ROWS)
    const working = countButton(container, 'working')
    expect(working.getAttribute('aria-pressed')).toBe('false')

    await click(working)
    expect(working.getAttribute('aria-pressed')).toBe('true')
    expect(listed(container)).toEqual(['a', 'c'])
    expect(container.querySelector('[data-team-activity-count]')?.textContent).toBe(
      '1 needs you2 working1 done'
    )

    await click(working)
    expect(working.getAttribute('aria-pressed')).toBe('false')
    expect(listed(container)).toEqual(['a', 'b', 'c', 'd'])
  })

  it('keeps one filter at a time and clears it with Escape', async () => {
    const { container } = await render(ROWS)
    await click(countButton(container, 'working'))
    await click(countButton(container, 'done'))
    expect(countButton(container, 'working').getAttribute('aria-pressed')).toBe('false')
    expect(listed(container)).toEqual(['b'])

    await act(async () => {
      countButton(container, 'done').dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })
      )
    })
    expect(listed(container)).toEqual(['a', 'b', 'c', 'd'])
  })

  it('keeps the filter through a live update and drops it when the tab changes', async () => {
    const { container, redraw } = await render(ROWS)
    await click(countButton(container, 'working'))
    await redraw([...ROWS, row('e', 'working')])
    expect(listed(container)).toEqual(['a', 'c', 'e'])

    await act(async () => useTeamPanelTabStore.getState().select('inbox'))
    await act(async () => useTeamPanelTabStore.getState().select('activity'))
    expect(countButton(container, 'working').getAttribute('aria-pressed')).toBe('false')
    expect(listed(container)).toHaveLength(5)
  })
})
