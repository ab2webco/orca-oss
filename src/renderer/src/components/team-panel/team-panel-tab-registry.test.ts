import { describe, expect, it, vi } from 'vitest'
import type {
  TeamLeadCard,
  TeamPanelGameModel,
  TeamPanelSoloModel,
  TeamPrList,
  TeamSection
} from '../../../../shared/team-panel-model-types'
import { resolveTeamPanelTabs } from './team-panel-tab-registry'

vi.mock('@/i18n/i18n', () => ({
  translate: (_key: string, fallback: string) => fallback
}))

const NO_PRS: TeamSection<TeamPrList> = {
  kind: 'ready',
  value: { rows: [], total: 0, listUrl: null, listAction: null }
}

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

function gameModel(overrides: Partial<TeamPanelGameModel> = {}): TeamPanelGameModel {
  return {
    kind: 'team',
    repoId: 'repo-1',
    projectName: 'orca-oss',
    lead,
    advisor: null,
    members: [],
    metrics: { kind: 'loading' },
    xp: null,
    arcade: null,
    stopped: null,
    scene: { id: null, extensions: [] },
    inbox: {
      kind: 'ready',
      value: { forYou: 0, waiting: 0, threads: 0, answered: 0 }
    },
    prs: null,
    queue: null,
    machines: null,
    ...overrides
  }
}

function soloModel(overrides: Partial<TeamPanelSoloModel> = {}): TeamPanelSoloModel {
  return {
    kind: 'solo',
    selectedPaneKey: null,
    rows: [],
    inbox: { kind: 'loading' },
    prs: null,
    queue: null,
    machines: null,
    ...overrides
  }
}

const ids = (tabs: { id: string }[]): string[] => tabs.map((tab) => tab.id)

describe('resolveTeamPanelTabs', () => {
  it('shows Team and Inbox, and hides tabs the model leaves null', () => {
    expect(ids(resolveTeamPanelTabs(gameModel()))).toEqual(['team', 'inbox'])
  })

  it('orders every visible tab as the approved design does', () => {
    const model = gameModel({
      prs: NO_PRS,
      queue: { kind: 'loading' },
      machines: { kind: 'error', message: 'host down' }
    })
    expect(ids(resolveTeamPanelTabs(model))).toEqual(['team', 'inbox', 'prs', 'queue', 'machines'])
  })

  it('opens on Activity instead of Team when there is no team', () => {
    const model = soloModel({ prs: NO_PRS })
    expect(ids(resolveTeamPanelTabs(model))).toEqual(['activity', 'inbox', 'prs'])
  })

  it('counts only the questions for the user, on Inbox alone', () => {
    const model = gameModel({
      inbox: {
        kind: 'ready',
        value: { forYou: 2, waiting: 3, threads: 4, answered: 5 }
      },
      prs: NO_PRS
    })
    expect(resolveTeamPanelTabs(model).map((tab) => [tab.id, tab.count])).toEqual([
      ['team', null],
      ['inbox', 2],
      ['prs', null]
    ])
  })

  it('shows no count while nothing waits for the user or Inbox has not loaded', () => {
    expect(resolveTeamPanelTabs(gameModel())[1].count).toBeNull()
    expect(resolveTeamPanelTabs(soloModel())[1].count).toBeNull()
  })

  it('carries each section state through to the tab view', () => {
    const model = gameModel({
      prs: { kind: 'loading' },
      queue: { kind: 'error', message: 'rate limited' },
      machines: { kind: 'unavailable' }
    })
    const views = Object.fromEntries(
      resolveTeamPanelTabs(model).map((tab) => [tab.id, tab.view.kind])
    )
    expect(views).toMatchObject({
      prs: 'loading',
      queue: 'error',
      machines: 'unavailable'
    })
  })

  it('says a project has no queue rather than that the host is old', () => {
    const queue = resolveTeamPanelTabs(gameModel({ queue: { kind: 'unavailable' } })).find(
      (tab) => tab.id === 'queue'
    )

    expect(queue?.view.kind).toBe('unavailable')
    expect(queue?.copy.unavailable?.title).toBe('No merge queue to show')
  })

  it('draws the empty state for a ready section with nothing in it', () => {
    const model = gameModel({ prs: NO_PRS })
    const prs = resolveTeamPanelTabs(model).find((tab) => tab.id === 'prs')
    expect(prs?.view.kind).toBe('empty')
  })

  it('draws the tab body for a ready section with rows', () => {
    const model = gameModel({
      prs: {
        kind: 'ready',
        value: {
          rows: [
            {
              label: '#7',
              number: 7,
              title: 'Fix',
              url: 'https://example.test/7',
              status: 'working',
              reason: 'inReview',
              memberKey: null
            }
          ],
          total: 1,
          listUrl: null,
          listAction: null
        }
      }
    })
    const prs = resolveTeamPanelTabs(model).find((tab) => tab.id === 'prs')
    expect(prs?.view.kind).toBe('ready')
  })

  it('draws the Team tab with no members, since the lead is its first card', () => {
    const team = resolveTeamPanelTabs(gameModel())[0]
    expect(team.view.kind).toBe('ready')
  })
})
