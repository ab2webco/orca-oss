import { beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  TeamActivityRow,
  TeamPanelModel,
  TeamPanelSoloModel
} from '../../../../shared/team-panel-model-types'

const openTeamSession = vi.hoisted(() => vi.fn())
vi.mock('./team-session-open', () => ({ openTeamSession }))

const { openTeamInboxAgent, teamInboxAgentQuestionsOf } = await import('./team-panel-inbox-agents')

function row(over: Partial<TeamActivityRow>): TeamActivityRow {
  return {
    paneKey: 'tab-1:leaf-1',
    terminalHandle: null,
    worktreeId: 'wt-1',
    host: { kind: 'local' },
    name: 'main',
    agentType: 'claude',
    status: 'working',
    condition: 'working',
    since: null,
    liveAction: null,
    model: null,
    account: null,
    repoName: 'orca-oss',
    worktreeName: 'main',
    isPrimary: true,
    prompt: null,
    ticket: null,
    pr: null,
    lastMessage: null,
    cacheExpiresAt: null,
    ports: [],
    note: null,
    subagentCount: 0,
    recentSteps: [],
    advisor: null,
    ...over
  }
}

const solo = (rows: TeamActivityRow[]): TeamPanelSoloModel => ({
  kind: 'solo',
  selectedPaneKey: null,
  rows,
  inbox: { kind: 'loading' },
  prs: null,
  queue: null,
  machines: null
})

beforeEach(() => openTeamSession.mockReset())

describe('No-team Inbox from agent status', () => {
  it('lists each agent that asks the user, from any project or host', () => {
    const asking = row({
      paneKey: 'tab-2:leaf-1',
      worktreeId: 'wt-2',
      host: { kind: 'remote', name: 'imac', environmentId: 'env-1', reachable: true },
      repoName: 'cineco',
      worktreeName: 'cin-1145',
      status: 'attention',
      condition: 'waiting',
      liveAction: { kind: 'question', text: 'Apply it now?', options: ['Yes', 'No'] }
    })
    const working = row({ liveAction: { kind: 'tool', tool: 'Bash', detail: 'ls' } })

    expect(teamInboxAgentQuestionsOf(solo([working, asking]))).toEqual([
      {
        paneKey: 'tab-2:leaf-1',
        terminalHandle: null,
        worktreeId: 'wt-2',
        host: { kind: 'remote', name: 'imac', environmentId: 'env-1', reachable: true },
        repoName: 'cineco',
        worktreeName: 'cin-1145',
        text: 'Apply it now?',
        options: ['Yes', 'No']
      }
    ])
  })

  // Why one path: a row and its question must open the same pane on every kind of host.
  it('opens a question the way its Activity row opens', () => {
    const question = {
      paneKey: 'tab-2:leaf-1',
      terminalHandle: 'term-2',
      worktreeId: 'wt-2',
      host: { kind: 'local' } as const,
      repoName: 'cineco',
      worktreeName: 'cin-1145',
      text: 'Apply it now?',
      options: ['Yes', 'No']
    }

    openTeamInboxAgent(question)

    expect(openTeamSession).toHaveBeenCalledWith(question, 'cin-1145')
  })

  // Why: with a team, the lead's board is the Inbox's source; member prompts stay on their cards.
  it('reads nothing from agent status when a team is open', () => {
    expect(teamInboxAgentQuestionsOf({ kind: 'team' } as TeamPanelModel)).toEqual([])
  })
})
