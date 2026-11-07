import { describe, expect, it, vi } from 'vitest'
import type {
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
  branch: null
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

const panel = (overrides: Partial<OrchestratorGamePanel> = {}): OrchestratorGamePanel => ({
  look: 'game',
  style: 'pixel',
  tabs: { prs: true, queue: true, machines: true },
  advisor: true,
  arcade: true,
  ...overrides
})

const tabIds = (model: TeamPanelGameModel | TeamPanelSoloModel): string[] =>
  resolveTeamPanelTabs(model).map((tab) => tab.id)

describe('teamPanelModelWithSettings', () => {
  it('keeps every tab and the Advisor row when the settings show them', () => {
    const shown = teamPanelModelWithSettings(team, panel())

    expect(tabIds(shown)).toEqual(['team', 'inbox', 'prs', 'queue', 'machines'])
    expect(shown.kind === 'team' && shown.advisor).toEqual(advisor)
  })

  it.each(['prs', 'queue', 'machines'] as const)(
    'hides the %s tab when its toggle is off',
    (id) => {
      const tabs = { prs: true, queue: true, machines: true, [id]: false }

      expect(tabIds(teamPanelModelWithSettings(team, panel({ tabs })))).not.toContain(id)
      expect(tabIds(teamPanelModelWithSettings(solo, panel({ tabs })))).not.toContain(id)
    }
  )

  it('drops the Advisor row under the lead when Advisor is off', () => {
    const hidden = teamPanelModelWithSettings(team, panel({ advisor: false }))

    expect(hidden.kind === 'team' ? hidden.advisor : 'solo').toBeNull()
  })
})
