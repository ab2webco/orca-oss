// @vitest-environment happy-dom

import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { OrchestratorGameLayer } from '../../../../shared/orchestrator-game-config'
import type { TeamLeadCard, TeamPanelGameModel } from '../../../../shared/team-panel-model-types'
import { TooltipProvider } from '@/components/ui/tooltip'
import { useTeamPanelTabStore } from './team-panel-tab-store'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

vi.mock('@/i18n/i18n', () => ({
  translate: (_key: string, fallback: string) => fallback
}))
const settings = { pluginSystemEnabled: true }
vi.mock('@/store', () => ({
  useAppStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({
      settings,
      openSettingsTarget: vi.fn(),
      openSettingsPage: vi.fn(),
      openTaskPage: vi.fn()
    })
}))
// Why: the dock reads the lead pane from the store; its own tests cover it, these cover the tabs.
vi.mock('./TeamActionDockConnected', () => ({ TeamActionDockConnected: () => null }))
let global: OrchestratorGameLayer | undefined
vi.mock('./team-panel-setting-layers', () => ({
  useTeamPanelSettingLayers: () => ({ global, project: undefined, local: undefined })
}))

const lead: TeamLeadCard = {
  paneKey: 'pane-lead',
  terminalHandle: null,
  worktreeId: null,
  host: { kind: 'local' },
  name: 'Lead',
  agentType: 'claude',
  status: 'working',
  condition: 'working',
  since: null,
  liveAction: null,
  model: null,
  account: null,
  characterKey: null,
  branch: null,
  ownerAsk: null
}

const team: TeamPanelGameModel = {
  kind: 'team',
  todo: [],
  repoId: 'repo-1',
  projectName: 'orca-oss',
  lead,
  advisor: {
    model: 'Opus 5.5',
    effort: null,
    pinned: { model: false, effort: false },
    line: 'Approved',
    previous: null,
    calls: []
  },
  members: [],
  metrics: { kind: 'unavailable' },
  xp: null,
  arcade: null,
  stopped: null,
  scene: { id: null, extensions: [] },
  inbox: { kind: 'ready', value: { forYou: 0, waiting: 0, threads: 0, answered: 0 } },
  prs: { kind: 'ready', value: { rows: [], total: 0, listUrl: null, listAction: null } },
  queue: { kind: 'ready', value: [] },
  machines: { kind: 'ready', value: [] },
  actions: []
}
vi.mock('./use-team-panel-model', () => ({
  useTeamPanelModel: () => ({ section: { kind: 'ready', value: team }, retry: null }),
  refreshTeamPanelModel: vi.fn()
}))

const { default: TeamPanel } = await import('./TeamPanel')

const roots: ReturnType<typeof createRoot>[] = []
afterEach(async () => {
  await act(async () => {
    for (const root of roots.splice(0)) {
      root.unmount()
    }
  })
  document.body.innerHTML = ''
  useTeamPanelTabStore.setState({ selected: null })
  settings.pluginSystemEnabled = true
})

async function render(panel: OrchestratorGameLayer['panel']): Promise<HTMLElement> {
  global = { panel: { look: 'plain', ...panel } }
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  roots.push(root)
  await act(async () =>
    root.render(
      <TooltipProvider>
        <TeamPanel />
      </TooltipProvider>
    )
  )
  return container
}

const tabs = (container: HTMLElement): string[] =>
  [...container.querySelectorAll('[role="tab"]')].map((tab) => tab.textContent ?? '')

describe('TeamPanel settings', () => {
  it('draws the tabs and the Advisor row the settings leave on', async () => {
    const container = await render({})

    // Why no Queue: V30 draws the merge queue at the top of PRs.
    expect(tabs(container)).toEqual(['Team', 'Inbox', 'PRs', 'Machines'])
    expect(container.querySelector('[data-team-card="advisor"]')).not.toBeNull()
  })

  it('hides the PRs, Queue and Machines tabs turned off, and the selected one falls back', async () => {
    useTeamPanelTabStore.setState({ selected: 'queue' })
    const container = await render({ tabs: { prs: false, queue: false, machines: false } })

    expect(tabs(container)).toEqual(['Team', 'Inbox'])
    expect(container.querySelector('[role="tab"][aria-selected="true"]')?.textContent).toBe('Team')
  })

  it('drops the Advisor row when Advisor is off', async () => {
    const container = await render({ advisor: false })

    expect(container.querySelector('[data-team-card="advisor"]')).toBeNull()
  })

  it('drops the Advisor row while the plugin system is off', async () => {
    settings.pluginSystemEnabled = false
    const container = await render({})

    expect(container.querySelector('[data-team-card="advisor"]')).toBeNull()
  })
})
