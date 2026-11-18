import { describe, expect, it, vi } from 'vitest'
import type { AgentStatusEntry } from '../../../../shared/agent-status-types'
import {
  teamActivityRowOf,
  type TeamSoloSession
} from '../../../../shared/team-panel-activity-rows'
import { sidebarSoloHoverOf, sidebarSoloTicketSource } from './sidebar-solo-hover'

vi.mock('@/i18n/i18n', () => ({
  translate: (_key: string, fallback: string, options?: Record<string, unknown>) =>
    fallback.replace(/\{\{(\w+)\}\}/g, (_, name: string) => String(options?.[name] ?? '')),
  getIntlLocale: () => 'en'
}))

function entryOf(patch: Partial<AgentStatusEntry> = {}): AgentStatusEntry {
  return {
    state: 'working',
    prompt: 'Add booking validation',
    model: 'claude-opus-5-5',
    effort: 'high',
    toolName: 'Bash',
    toolInput: 'gh pr checks 912',
    updatedAt: 1,
    stateStartedAt: 1,
    paneKey: 'tab-1:leaf-1',
    stateHistory: [],
    ...patch
  }
}

function sessionOf(patch: Partial<TeamSoloSession> = {}): TeamSoloSession {
  return {
    entry: entryOf(),
    repoName: 'cineco-orchestrator',
    worktreeName: 'cin-1145',
    worktreeId: 'wt-1',
    isPrimary: false,
    inTeam: false,
    host: { kind: 'remote', name: 'imac', environmentId: null, reachable: true },
    ticket: { identifier: 'CIN-1145', title: null, url: null, statusGroup: null },
    pr: {
      provider: 'github',
      number: 912,
      title: 'Booking validation',
      url: 'https://example.test/pr/912',
      state: 'open',
      ci: 'success',
      verdict: null,
      perfectMerge: null
    },
    note: 'Waits on the API change',
    ports: [3000, 5173],
    account: { provider: 'claude', email: 'fabiana@example.com', usedPercent: null },
    cacheExpiresAt: 90_000,
    advisor: null,
    ...patch
  }
}

const hoverOf = (patch: Partial<TeamSoloSession> = {}) =>
  sidebarSoloHoverOf(teamActivityRowOf(sessionOf(patch)))

const textOf = (hover: ReturnType<typeof sidebarSoloHoverOf>): string[] =>
  hover.lines.map((line) =>
    line.kind === 'cache' ? `${line.label}: timer` : `${line.label}: ${line.value}`
  )

describe('sidebarSoloHoverOf (V30 hoverHtml for a solo row)', () => {
  it('names the worktree, then its repo and remote host, then the facts in V30 order', () => {
    const hover = hoverOf()
    expect(hover.title).toBe('cin-1145')
    expect(hover.subtitle).toBe('cineco-orchestrator · imac')
    expect(textOf(hover)).toEqual([
      'State: Working',
      'Prompt: Add booking validation',
      'Now: Bash · gh pr checks 912',
      'Model: Opus 5.5 · high',
      'Account: fabiana',
      'Cache: timer',
      'PR: #912 · CI green',
      'Ticket: CIN-1145',
      'Ports: 3000, 5173',
      'Notes: Waits on the API change'
    ])
  })

  it('marks the PR and Ticket lines as the ones that open in Orca', () => {
    const opens = hoverOf().lines.flatMap((line) =>
      line.kind === 'text' && line.opens ? [`${line.label}:${line.opens}`] : []
    )
    expect(opens).toEqual(['PR:pr', 'Ticket:ticket'])
  })

  it('marks the primary worktree and names no host on this machine', () => {
    const hover = hoverOf({ isPrimary: true, host: { kind: 'local' } })
    expect(hover.title).toBe('cin-1145 · primary')
    expect(hover.subtitle).toBe('cineco-orchestrator')
  })

  it('asks in the question tone while waiting, with no Now line', () => {
    const waiting = hoverOf({
      entry: entryOf({
        state: 'blocked',
        toolName: 'AskUserQuestion',
        interactivePrompt: JSON.stringify({
          questions: [{ question: 'Apply it now?', multiSelect: false, options: [] }]
        })
      })
    })
    const lines = waiting.lines.filter((line) => line.kind === 'text')
    expect(lines.find((line) => line.label === 'State')).toMatchObject({
      value: 'Needs you',
      asks: true
    })
    expect(lines.find((line) => line.label === 'Question')).toMatchObject({
      value: 'Apply it now?',
      asks: true
    })
    expect(lines.some((line) => line.label === 'Now')).toBe(false)
  })

  it('never prints a full email or a non-email account label', () => {
    expect(textOf(hoverOf())).not.toContain('Account: fabiana@example.com')
    const label = hoverOf({
      account: { provider: 'claude', email: 'System default', usedPercent: null }
    })
    expect(label.lines.some((line) => line.label === 'Account')).toBe(false)
  })

  it('leaves out every fact the session does not have', () => {
    const bare = hoverOf({
      host: { kind: 'local' },
      ticket: null,
      pr: null,
      note: null,
      ports: [],
      account: null,
      cacheExpiresAt: null,
      entry: entryOf({ model: undefined, effort: undefined, toolName: undefined })
    })
    expect(textOf(bare)).toEqual(['State: Working', 'Prompt: Add booking validation'])
  })
})

describe('sidebarSoloTicketSource', () => {
  const none = {
    linkedPlaneWorkItem: null,
    linkedLinearIssue: null,
    linkedWorkItem: null,
    linkedIssue: null,
    linkedGitLabIssue: null
  }
  it('picks the tracker the Ticket line names, in the same order', () => {
    const plane = { identifier: 'ORCA-1', id: 'p', projectId: 'x' } as never
    const jira = { provider: 'jira', type: 'issue', number: 7, title: 'T', url: 'u' } as never
    expect(
      sidebarSoloTicketSource({ ...none, linkedPlaneWorkItem: plane, linkedLinearIssue: 'L-1' })
    ).toBe('plane')
    expect(sidebarSoloTicketSource({ ...none, linkedLinearIssue: 'L-1', linkedIssue: 3 })).toBe(
      'linear'
    )
    expect(sidebarSoloTicketSource({ ...none, linkedWorkItem: jira, linkedIssue: 3 })).toBe('jira')
    expect(sidebarSoloTicketSource({ ...none, linkedIssue: 3 })).toBe('issue')
    expect(sidebarSoloTicketSource({ ...none, linkedGitLabIssue: 4 })).toBe('issue')
    expect(sidebarSoloTicketSource(none)).toBeNull()
  })
})
