import { describe, expect, it, vi } from 'vitest'
import type {
  TeamActivityRow,
  TeamAdvisorRow,
  TeamLeadCard,
  TeamPanelGameModel,
  TeamPanelSoloModel
} from '../../../../shared/team-panel-model-types'
import type { OrchestratorGamePanel } from '../../../../shared/orchestrator-game-panel'
import { teamPanelModelWithSettings } from './team-panel-model-settings'
import { resolveTeamPanelTabs } from './team-panel-tab-registry'

vi.mock('@/i18n/i18n', () => ({
  translate: (_key: string, fallback: string) => fallback
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

const advisor: TeamAdvisorRow = {
  model: 'Opus 5.5',
  effort: 'high',
  pinned: { model: false, effort: false },
  line: 'Approved',
  previous: null,
  calls: []
}

const team: TeamPanelGameModel = {
  kind: 'team',
  repoId: 'repo-1',
  projectName: 'orca-oss',
  lead,
  advisor,
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

const solo: TeamPanelSoloModel = {
  kind: 'solo',
  selectedPaneKey: null,
  rows: [],
  inbox: { kind: 'loading' },
  prs: { kind: 'loading' },
  queue: { kind: 'loading' },
  machines: { kind: 'loading' }
}

type PanelSettings = OrchestratorGamePanel & { pluginsOn: boolean }

const panel = (overrides: Partial<PanelSettings> = {}): PanelSettings => ({
  look: 'game',
  style: 'pixel',
  tabs: { prs: true, queue: true, machines: true },
  advisor: true,
  arcade: true,
  pluginsOn: true,
  ...overrides
})

const tabIds = (model: TeamPanelGameModel | TeamPanelSoloModel): string[] =>
  resolveTeamPanelTabs(model).map((tab) => tab.id)

describe('teamPanelModelWithSettings', () => {
  it('keeps every tab and the Advisor row when the settings show them', () => {
    const shown = teamPanelModelWithSettings(team, panel())

    expect(tabIds(shown)).toEqual(['team', 'inbox', 'prs', 'machines'])
    expect(shown.queue).toEqual(team.queue)
    expect(shown.kind === 'team' && shown.advisor).toEqual(advisor)
  })

  it('drops the merge queue from PRs when the Queue toggle is off', () => {
    const tabs = { prs: true, queue: false, machines: true }

    expect(teamPanelModelWithSettings(team, panel({ tabs })).queue).toBeNull()
    expect(teamPanelModelWithSettings(solo, panel({ tabs })).queue).toBeNull()
  })

  it.each(['prs', 'machines'] as const)('hides the %s tab when its toggle is off', (id) => {
    const tabs = { prs: true, queue: true, machines: true, [id]: false }

    expect(tabIds(teamPanelModelWithSettings(team, panel({ tabs })))).not.toContain(id)
    expect(tabIds(teamPanelModelWithSettings(solo, panel({ tabs })))).not.toContain(id)
  })

  it("drops each no-team session's Jev section when Advisor is off", () => {
    const row = { paneKey: 'pane-a', advisor } as TeamActivityRow
    const model: TeamPanelSoloModel = {
      kind: 'solo',
      selectedPaneKey: null,
      rows: [row],
      inbox: { kind: 'loading' },
      prs: null,
      queue: null,
      machines: null
    }
    const hidden = teamPanelModelWithSettings(model, panel({ advisor: false }))
    expect(hidden.kind === 'solo' ? hidden.rows[0]?.advisor : 'team').toBeNull()
    const shown = teamPanelModelWithSettings(model, panel())
    expect(shown.kind === 'solo' ? shown.rows[0]?.advisor : 'team').toEqual(advisor)
  })

  // Why: Jev reaches a pane only through its plugin, and a kept report would outlive it.
  it('drops every Jev row and section while the plugin system is off', () => {
    const row = { paneKey: 'pane-a', advisor } as TeamActivityRow
    const soloRows = { ...solo, rows: [row] }
    const off = panel({ pluginsOn: false })

    expect(teamPanelModelWithSettings(team, off)).toMatchObject({ advisor: null })
    expect(teamPanelModelWithSettings(soloRows, off)).toMatchObject({ rows: [{ advisor: null }] })
    expect(teamPanelModelWithSettings(team, panel())).toMatchObject({ advisor })
  })

  it('drops the Advisor row under the lead when Advisor is off', () => {
    const hidden = teamPanelModelWithSettings(team, panel({ advisor: false }))

    expect(hidden.kind === 'team' ? hidden.advisor : 'solo').toBeNull()
  })
})
