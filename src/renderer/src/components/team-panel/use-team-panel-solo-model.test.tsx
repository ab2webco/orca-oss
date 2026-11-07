// @vitest-environment happy-dom

import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentStatusEntry } from '../../../../shared/agent-status-types'
import type { GameHostReading } from '../../../../shared/orchestrator-game-host-capacity'
import type { TeamPanelSoloModel } from '../../../../shared/team-panel-model-types'
import type { Repo, Worktree } from '../../../../shared/types'
import { useTeamPanelTabStore } from './team-panel-tab-store'

const GB = 1024 ** 3
const LEAF_A = '11111111-1111-4111-8111-111111111111'
const LEAF_B = '22222222-2222-4222-8222-222222222222'
const LEAF_C = '33333333-3333-4333-8333-333333333333'

const repo = { id: 'repo-1', path: '/r', displayName: 'orca-oss' } as Repo
const worktree = (id: string, hostId: string | undefined): Worktree =>
  ({
    id,
    repoId: 'repo-1',
    path: `/r/${id}`,
    displayName: id,
    comment: '',
    branch: `refs/heads/${id}`,
    hostId
  }) as unknown as Worktree
const entry = (paneKey: string, worktreeId: string): AgentStatusEntry => ({
  state: 'working',
  prompt: 'Work',
  updatedAt: 1,
  stateStartedAt: 1,
  agentType: 'claude',
  paneKey,
  worktreeId,
  stateHistory: []
})

const environments = [{ id: 'env-1', name: 'mini' }]
const threeHosts = (): Record<string, unknown> => ({
  activeWorktreeId: null,
  agentStatusByPaneKey: {
    [`tab-a:${LEAF_A}`]: entry(`tab-a:${LEAF_A}`, 'here'),
    [`tab-b:${LEAF_B}`]: entry(`tab-b:${LEAF_B}`, 'paired'),
    [`tab-c:${LEAF_C}`]: entry(`tab-c:${LEAF_C}`, 'remote')
  },
  tabsByWorktree: {
    here: [{ id: 'tab-a' }],
    paired: [{ id: 'tab-b' }],
    remote: [{ id: 'tab-c' }]
  },
  worktreesByRepo: {
    'repo-1': [
      worktree('here', undefined),
      worktree('paired', 'runtime:env-1'),
      worktree('remote', 'ssh:box-id')
    ]
  },
  repos: [repo],
  settings: null,
  cacheTimerByKey: {},
  hostedReviewCache: {},
  workspacePortScan: null,
  claudeAccountRoster: { accounts: [], activeAccountId: null },
  folderWorkspaces: [],
  runtimeEnvironments: environments,
  sshTargetLabels: new Map([['box-id', 'box']]),
  sshConnectionStates: new Map()
})
let appState = threeHosts()
vi.mock('@/store', () => ({
  useAppStore: Object.assign(
    (selector: (state: Record<string, unknown>) => unknown) => selector(appState),
    { getState: () => appState }
  )
}))

const readings = vi.hoisted(() => vi.fn())
vi.mock('./use-team-solo-machine-readings', () => ({ useTeamSoloMachineReadings: readings }))
const advisors = vi.hoisted(() => vi.fn())
vi.mock('./use-team-solo-advisors', () => ({ useTeamSoloAdvisors: advisors }))

const { useTeamPanelSoloModel } = await import('./use-team-panel-solo-model')

let model: TeamPanelSoloModel | null = null
let root: ReturnType<typeof createRoot> | null = null
function Probe({ active }: { active: boolean }): null {
  model = useTeamPanelSoloModel(active)
  return null
}
async function mount(active = true): Promise<void> {
  root = createRoot(document.createElement('div'))
  await act(async () => root?.render(<Probe active={active} />))
}

const ok = (availableMemory: number): GameHostReading => ({
  kind: 'ok',
  machine: { cpuCoreCount: 8, totalMemory: 16 * GB, availableMemory, loadAverage1m: 1 }
})

beforeEach(() => {
  appState = threeHosts()
  readings.mockReset()
  readings.mockReturnValue(null)
  advisors.mockReset()
  advisors.mockReturnValue(new Map())
  useTeamPanelTabStore.setState({ shown: null })
})
afterEach(async () => {
  await act(async () => root?.unmount())
  root = null
  model = null
})

describe('useTeamPanelSoloModel Machines', () => {
  it('hides Machines while every session runs on one host', async () => {
    appState = {
      ...threeHosts(),
      runtimeEnvironments: [],
      worktreesByRepo: { 'repo-1': [worktree('here', undefined)] }
    }

    await mount()

    expect(model?.rows).toHaveLength(1)
    expect(model?.machines).toBeNull()
  })

  it('shows the tab loading until a host answers, and reads nothing off screen', async () => {
    await mount()

    expect(model?.machines).toEqual({ kind: 'loading' })
    expect(readings).toHaveBeenCalledWith('env-1', false)
  })

  it('reads the hosts while Machines is the tab on screen', async () => {
    useTeamPanelTabStore.setState({ shown: 'machines' })

    await mount()

    expect(readings).toHaveBeenCalledWith('env-1', true)
  })

  it('reads nothing while a team fills the panel', async () => {
    useTeamPanelTabStore.setState({ shown: 'machines' })

    await mount(false)

    expect(readings).toHaveBeenCalledWith('', false)
    expect(model).toBeNull()
  })

  it('lists this machine, the paired host and the SSH target with their own counts', async () => {
    readings.mockReturnValue(
      new Map<string, GameHostReading>([
        ['', ok(8 * GB)],
        ['env-1', { kind: 'unreachable' }]
      ])
    )

    await mount()

    expect(model?.machines?.kind).toBe('ready')
    const rows = model?.machines?.kind === 'ready' ? model.machines.value : []
    expect(rows.map((one) => (one.host.kind === 'local' ? 'local' : one.host.name))).toEqual([
      'local',
      'mini',
      'box'
    ])
    expect(rows.map((one) => one.running)).toEqual([1, 1, 1])
    expect(rows.map((one) => one.reading.kind)).toEqual(['ok', 'unreachable', 'unread'])
  })
})

describe('useTeamPanelSoloModel Jev', () => {
  const reads = [
    { environmentId: null, paneKeys: [`tab-a:${LEAF_A}`] },
    { environmentId: 'env-1', paneKeys: [`tab-b:${LEAF_B}`] }
  ]

  it('asks each host with an Orca for its own panes, while Activity shows and plugins are on', async () => {
    appState = { ...threeHosts(), settings: { pluginSystemEnabled: true } }
    useTeamPanelTabStore.setState({ shown: 'activity' })

    await mount()

    expect(advisors).toHaveBeenCalledWith(JSON.stringify(reads), true)
  })

  it('reads nothing with the plugin system off', async () => {
    useTeamPanelTabStore.setState({ shown: 'activity' })

    await mount()

    expect(advisors).toHaveBeenCalledWith(JSON.stringify(reads), false)
  })

  it('reads nothing while another tab shows', async () => {
    appState = { ...threeHosts(), settings: { pluginSystemEnabled: true } }
    useTeamPanelTabStore.setState({ shown: 'inbox' })

    await mount()

    expect(advisors).toHaveBeenCalledWith(JSON.stringify(reads), false)
  })

  it('drops what it read once the plugin system goes off, so the report names no model', async () => {
    advisors.mockReturnValue(
      new Map([
        [
          `tab-a:${LEAF_A}`,
          { model: 'Sonnet 5.5', effort: 'low', pinned: { model: true, effort: false } }
        ]
      ])
    )

    await mount()

    expect(model?.rows.every((row) => row.advisor === null)).toBe(true)
  })

  it("puts a pane's report on its own row, and no section on the others", async () => {
    appState = { ...threeHosts(), settings: { pluginSystemEnabled: true } }
    advisors.mockReturnValue(
      new Map([
        [
          `tab-a:${LEAF_A}`,
          {
            model: 'Sonnet 5.5',
            effort: 'low',
            pinned: { model: true, effort: false },
            previous: { model: 'Opus 5.5', effort: 'high' }
          }
        ]
      ])
    )

    await mount()

    const held = model?.rows.find((row) => row.paneKey === `tab-a:${LEAF_A}`)
    expect(held?.advisor).toEqual({
      model: 'Sonnet 5.5',
      effort: 'low',
      pinned: { model: true, effort: false },
      line: null,
      previous: { model: 'Opus 5.5', effort: 'high' },
      calls: []
    })
    expect(model?.rows.filter((row) => row.advisor !== null)).toHaveLength(1)
  })
})
