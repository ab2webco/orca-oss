import { describe, expect, it } from 'vitest'
import type { AgentStatusEntry } from './agent-status-types'
import { teamSoloModelOf, type TeamSoloSession } from './team-panel-activity-rows'
import type { TeamPanelTabs } from './team-panel-model-types'

const entry = (over: Partial<AgentStatusEntry> = {}): AgentStatusEntry => ({
  state: 'working',
  prompt: 'Fix the checks tooltip',
  updatedAt: 20,
  stateStartedAt: 10,
  paneKey: 'tab:leaf',
  stateHistory: [],
  ...over
})

const session = (over: Partial<TeamSoloSession> = {}): TeamSoloSession => ({
  entry: entry(),
  repoName: 'orca-oss',
  worktreeName: 'fix-tooltip',
  worktreeId: 'repo::/w/fix-tooltip',
  isPrimary: false,
  host: { kind: 'local' },
  ticket: null,
  pr: null,
  note: null,
  ports: [],
  account: null,
  cacheExpiresAt: null,
  advisor: null,
  ...over
})

const tabs: TeamPanelTabs = {
  inbox: { kind: 'loading' },
  prs: { kind: 'loading' },
  queue: null,
  machines: { kind: 'loading' }
}

const ask = JSON.stringify({
  questions: [
    {
      question: 'Apply the migration now?',
      multiSelect: false,
      options: [{ label: 'Now' }, { label: 'At release' }]
    }
  ]
})

const rowsOf = (sessions: TeamSoloSession[]) =>
  teamSoloModelOf({ sessions, selectedPaneKey: null, tabs }).rows

describe('teamSoloModelOf', () => {
  it('shows a working agent by its tool step, model label and worktree', () => {
    const [row] = rowsOf([
      session({
        entry: entry({
          toolName: 'Bash',
          toolInput: 'gh pr checks 912',
          model: 'claude-opus-5-5',
          agentType: 'claude',
          terminalHandle: 'term_1',
          subagents: [{ id: 's1' } as never]
        })
      })
    ])
    expect(row).toMatchObject({
      paneKey: 'tab:leaf',
      terminalHandle: 'term_1',
      worktreeId: 'repo::/w/fix-tooltip',
      name: 'fix-tooltip',
      repoName: 'orca-oss',
      agentType: 'claude',
      status: 'working',
      condition: 'working',
      since: 10,
      liveAction: { kind: 'tool', tool: 'Bash', detail: 'gh pr checks 912' },
      model: { label: 'Opus 5.5', effort: null, source: 'session' },
      prompt: 'Fix the checks tooltip',
      subagentCount: 1
    })
  })

  it('shows a blocked agent by its question and choices, in red', () => {
    const [row] = rowsOf([
      session({
        entry: entry({ state: 'blocked', toolName: 'AskUserQuestion', interactivePrompt: ask })
      })
    ])
    expect(row).toMatchObject({
      status: 'attention',
      condition: 'waiting',
      liveAction: {
        kind: 'question',
        text: 'Apply the migration now?',
        options: ['Now', 'At release']
      }
    })
  })

  it('keeps the last message of a finished turn and greys an interrupted one', () => {
    const [done, stopped] = rowsOf([
      session({
        entry: entry({ paneKey: 'a', state: 'done', lastCompletedAssistantMessage: 'Tests pass.' })
      }),
      session({ entry: entry({ paneKey: 'b', state: 'done', interrupted: true }) })
    ])
    expect(done).toMatchObject({ status: 'done', condition: 'done', lastMessage: 'Tests pass.' })
    expect(done?.liveAction).toBeNull()
    expect(stopped).toMatchObject({ status: 'idle', condition: 'idle' })
  })

  it('prefers the model Jev has the agent on', () => {
    const [row] = rowsOf([
      session({
        entry: entry({ model: 'claude-opus-5-5' }),
        advisor: {
          model: 'Sonnet 5.5',
          effort: 'medium',
          pinned: { model: false, effort: false },
          line: null,
          previous: null,
          calls: []
        }
      })
    ])
    expect(row?.model).toEqual({ label: 'Sonnet 5.5', effort: 'medium', source: 'advisor' })
  })

  it('orders rows needs-you first and opens on the selected row, else the first', () => {
    const sessions = [
      session({ entry: entry({ paneKey: 'idle', state: 'done', sessionBoundary: true }) }),
      session({ entry: entry({ paneKey: 'work' }) }),
      session({ entry: entry({ paneKey: 'wait', state: 'waiting' }) })
    ]
    const first = teamSoloModelOf({ sessions, selectedPaneKey: null, tabs })
    expect(first.rows.map((one) => one.paneKey)).toEqual(['wait', 'work', 'idle'])
    expect(first.selectedPaneKey).toBe('wait')
    expect(teamSoloModelOf({ sessions, selectedPaneKey: 'work', tabs }).selectedPaneKey).toBe(
      'work'
    )
    expect(teamSoloModelOf({ sessions, selectedPaneKey: 'gone', tabs }).selectedPaneKey).toBe(
      'wait'
    )
    expect(teamSoloModelOf({ sessions: [], selectedPaneKey: null, tabs }).selectedPaneKey).toBe(
      null
    )
  })

  it('shows Machines only when sessions span more than one host', () => {
    const local = session({ entry: entry({ paneKey: 'a' }) })
    const remote = session({
      entry: entry({ paneKey: 'b' }),
      host: { kind: 'remote', name: 'imac', environmentId: 'env', reachable: true }
    })
    expect(teamSoloModelOf({ sessions: [local], selectedPaneKey: null, tabs }).machines).toBeNull()
    expect(
      teamSoloModelOf({ sessions: [local, remote], selectedPaneKey: null, tabs }).machines
    ).toEqual({ kind: 'loading' })
    expect(teamSoloModelOf({ sessions: [local], selectedPaneKey: null, tabs })).toMatchObject({
      kind: 'solo',
      inbox: { kind: 'loading' },
      prs: { kind: 'loading' },
      queue: null
    })
  })
})
