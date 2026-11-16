import { describe, expect, it } from 'vitest'
import {
  selectCIFailingWorktreeIds,
  selectWorkspaceUrgencySignals
} from './workspace-urgency-signals'
import type { UrgencySourceState } from './workspace-urgency-signals'
import { repo, worktree } from '../../worktree-list-groups-test-fixtures'
import type { AgentStatusEntry } from '../../../../../../shared/agent-status-types'
import type {
  TeamLeadCard,
  TeamMemberCard,
  TeamPanelGameModel
} from '../../../../../../shared/team-panel-model-types'

const NOW = 1_800_000_000_000
const LEAF = (n: number) => `00000000-0000-4000-8000-00000000000${n}`

function entry(
  worktreeId: string,
  n: number,
  state: AgentStatusEntry['state'],
  extra: Partial<AgentStatusEntry> = {}
): AgentStatusEntry {
  return {
    state,
    prompt: '',
    updatedAt: NOW - 1_000,
    stateStartedAt: NOW - 1_000,
    paneKey: `tab-${n}:${LEAF(n)}`,
    worktreeId,
    stateHistory: [],
    ...extra
  }
}

function source(entries: AgentStatusEntry[]): UrgencySourceState {
  return {
    tabsByWorktree: {},
    agentStatusByPaneKey: Object.fromEntries(entries.map((e) => [e.paneKey, e])),
    runtimePaneTitlesByTabId: {},
    ptyIdsByTabId: {},
    migrationUnsupportedByPtyId: {},
    terminalLayoutsByTabId: {}
  }
}

const wt = (id: string) => ({ ...worktree, id })
const worktrees = ['ask', 'perm', 'run', 'done', 'quiet', 'limited', 'member-ask'].map(wt)

const lead = {
  paneKey: 'lead',
  worktreeId: 'lead-wt',
  condition: 'working'
} as TeamLeadCard
const member = (worktreeId: string, extra: Partial<TeamMemberCard>) =>
  ({
    paneKey: worktreeId,
    worktreeId,
    condition: 'idle',
    needsYou: false,
    ...extra
  }) as TeamMemberCard
const roster: Pick<TeamPanelGameModel, 'lead' | 'members'> = {
  lead,
  members: [
    member('limited', { condition: 'limited' }),
    member('member-ask', { needsYou: true }),
    member('run', { condition: 'limited' })
  ]
}

describe('selectCIFailingWorktreeIds', () => {
  it('lists the workspaces whose open PR fails CI in the live cache', () => {
    const repoMap = new Map([[repo.id, repo]])
    const red = { ...worktree, id: 'red', branch: 'refs/heads/red' }
    const green = { ...worktree, id: 'green', branch: 'refs/heads/green' }
    const prCache = {
      'repo-1::red': { data: { state: 'open', checksStatus: 'failure' } },
      'repo-1::green': { data: { state: 'open', checksStatus: 'success' } }
    }
    expect([...selectCIFailingWorktreeIds([red, green], repoMap, prCache, null)]).toEqual(['red'])
    expect(selectCIFailingWorktreeIds([red], repoMap, {}, null).size).toBe(0)
  })
})

describe('selectWorkspaceUrgencySignals', () => {
  it('reads questions, permission prompts and running agents from the agent hooks', () => {
    const signals = selectWorkspaceUrgencySignals(
      source([
        entry('ask', 1, 'waiting'),
        entry('perm', 2, 'blocked'),
        entry('run', 3, 'working'),
        entry('done', 4, 'done')
      ]),
      null,
      worktrees,
      NOW
    )
    expect(Object.fromEntries(signals)).toEqual({
      ask: 'question',
      perm: 'question',
      run: 'working'
    })
  })

  it('ignores a stale hook row', () => {
    const stale = entry('ask', 1, 'waiting', { updatedAt: NOW - 2 * 60 * 60 * 1000 })
    expect(selectWorkspaceUrgencySignals(source([stale]), null, worktrees, NOW).size).toBe(0)
  })

  it('reads an account limit and an open question from the team roster', () => {
    const signals = selectWorkspaceUrgencySignals(
      source([entry('run', 3, 'working')]),
      roster,
      worktrees,
      NOW
    )
    expect(signals.get('limited')).toBe('account-limit')
    expect(signals.get('member-ask')).toBe('question')
    // A limited member's stopped agent is not "working".
    expect(signals.get('run')).toBe('account-limit')
    expect(signals.has('lead-wt')).toBe(false)
  })
})
