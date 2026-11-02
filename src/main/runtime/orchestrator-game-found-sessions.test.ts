import { describe, expect, it } from 'vitest'
import { foundGameSessionsOf, recoveredGameMembersOf } from './orchestrator-game-found-sessions'
import type { GameAgent } from '../../shared/orchestrator-game-state'

const row = (paneKey: string, overrides: Record<string, unknown> = {}) => ({
  paneKey,
  parentPaneKey: null,
  state: 'working' as const,
  agentType: 'claude' as const,
  displayName: null,
  taskTitle: null,
  toolName: null,
  ...overrides
})

const summary = (worktreeId: string, branch: string, agents: ReturnType<typeof row>[]) => ({
  worktreeId,
  branch,
  displayName: worktreeId,
  agents
})

const live = new Set([
  'tab-1:lead',
  'tab-2:plain',
  'tab-3:codex',
  'tab-4:member',
  'tab-5:other-lead',
  'tab-6:other-member',
  'tab-7:orphan',
  'tab-9:folder'
])

const pick = (
  summaries: ReturnType<typeof summary>[],
  isLeadPane: (paneKey: string) => boolean = () => false
) =>
  foundGameSessionsOf(summaries, {
    leadPaneKey: 'tab-1:lead',
    hasTerminal: (paneKey) => live.has(paneKey),
    isLeadPane
  }).map((one) => [one.row.paneKey, one.worktree.id, one.worktree.branch])

// Which of this machine's sessions a lead lists as found (ORCA-914).
describe('foundGameSessionsOf', () => {
  it('takes every live root session of any agent, in git worktrees and folder workspaces alike', () => {
    expect(
      pick([
        summary('wt-lead', 'refs/heads/main', [row('tab-1:lead')]),
        summary('wt-914', 'refs/heads/fabolivark/orca-914', [row('tab-2:plain')]),
        summary('wt-x', 'feat/x', [row('tab-3:codex', { agentType: 'codex' })]),
        summary('folder:notes', '', [row('tab-9:folder', { agentType: 'opencode' })])
      ])
    ).toEqual([
      ['tab-2:plain', 'wt-914', 'fabolivark/orca-914'],
      ['tab-3:codex', 'wt-x', 'feat/x'],
      ['tab-9:folder', 'folder:notes', '']
    ])
  })

  it('leaves out the lead, its own members, and a live lead elsewhere with its members (ORCA-848)', () => {
    expect(
      pick([
        summary('wt-lead', 'main', [row('tab-1:lead')]),
        summary('wt-m', 'cin-1', [row('tab-4:member', { parentPaneKey: 'tab-1:lead' })]),
        summary('wt-o', 'main', [row('tab-5:other-lead')]),
        summary('wt-om', 'cin-2', [
          row('tab-6:other-member', { parentPaneKey: 'tab-5:other-lead' })
        ])
      ])
    ).toEqual([])
  })

  it('counts a pane with a Run of its own as a lead even before it launched anyone', () => {
    expect(
      pick(
        [summary('wt-o', 'main', [row('tab-5:other-lead')])],
        (paneKey) => paneKey === 'tab-5:other-lead'
      )
    ).toEqual([])
  })

  it('takes a member whose lead is gone, since nothing else lists it', () => {
    expect(
      pick([summary('wt-7', 'cin-7', [row('tab-7:orphan', { parentPaneKey: 'tab-0:gone' })])])
    ).toEqual([['tab-7:orphan', 'wt-7', 'cin-7']])
  })

  it('leaves out rows with no live terminal or only restored from disk, which may be long closed', () => {
    expect(
      pick([
        summary('wt-z', 'z', [
          row('tab-8:closed'),
          row('tab-2:plain', { restoredUnconfirmed: true })
        ])
      ])
    ).toEqual([])
  })
})

describe('recoveredGameMembersOf (ORCA-735)', () => {
  const found = (paneKey: string, worktreeId: string): GameAgent => ({
    paneKey,
    displayName: worktreeId,
    agentType: 'claude',
    state: 'idle',
    toolName: null,
    isLeader: false,
    isMember: true,
    found: true,
    worktree: { id: worktreeId, branch: worktreeId, displayName: worktreeId }
  })
  const saved = {
    ticket: 'ORCA-665',
    name: 'Merlin · ORCA-665',
    branch: 'orca-665',
    worktreeId: 'wt-665'
  }

  it("takes back a found session in a saved member's worktree as that member, under its name", () => {
    const { agents, unlisted } = recoveredGameMembersOf(
      [found('tab-2', 'wt-665'), found('tab-3', 'wt-other')],
      [saved]
    )

    expect(agents.map((agent) => [agent.paneKey, agent.displayName, agent.found ?? false])).toEqual(
      [
        ['tab-2', 'Merlin · ORCA-665', false],
        ['tab-3', 'wt-other', true]
      ]
    )
    expect(unlisted).toEqual([])
  })

  it('keeps a saved member unlisted while no found session runs in its worktree', () => {
    const { unlisted } = recoveredGameMembersOf([found('tab-3', 'wt-other')], [saved])

    expect(unlisted).toEqual([saved])
  })
})
