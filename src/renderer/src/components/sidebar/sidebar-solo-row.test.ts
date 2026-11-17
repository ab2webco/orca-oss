import { describe, expect, it, vi } from 'vitest'
import type { DashboardAgentRow } from '@/components/dashboard/useDashboardData'
import type { AgentStatusEntry } from '../../../../shared/agent-status-types'
import {
  sidebarSoloAgentOf,
  sidebarSoloRowLines,
  type SidebarSoloRowLineOptions
} from './sidebar-solo-row'

vi.mock('@/i18n/i18n', () => ({
  translate: (_key: string, fallback: string, options?: Record<string, unknown>) =>
    fallback.replace(/\{\{(\w+)\}\}/g, (_, name: string) => String(options?.[name] ?? '')),
  getIntlLocale: () => 'en'
}))

function entryOf(patch: Partial<AgentStatusEntry> = {}): AgentStatusEntry {
  return {
    state: 'working',
    prompt: 'Review the merge queue',
    updatedAt: 1,
    stateStartedAt: 1,
    paneKey: 'tab-1:leaf-1',
    stateHistory: [],
    ...patch
  }
}

function rowOf(
  paneKey: string,
  rowSource: DashboardAgentRow['rowSource'] = 'live',
  entry: AgentStatusEntry = entryOf({ paneKey })
): DashboardAgentRow {
  return {
    paneKey,
    entry,
    tab: { id: paneKey.split(':')[0] } as DashboardAgentRow['tab'],
    agentType: 'claude',
    rowSource,
    state: entry.state,
    startedAt: 1
  }
}

const OPTIONS: SidebarSoloRowLineOptions = {
  properties: ['inline-agents'],
  flat: false,
  repoName: 'orca-oss',
  remoteHost: null,
  underHostHeader: false,
  subagents: 0,
  ports: [],
  account: null
}

describe('sidebarSoloAgentOf', () => {
  it('picks the one live agent and counts its subagents', () => {
    const solo = sidebarSoloAgentOf([
      rowOf('tab-1:leaf-1'),
      rowOf('tab-1:leaf-1::sub-a', 'subagent'),
      rowOf('tab-1:leaf-1::sub-b', 'subagent')
    ])
    expect(solo?.agent.paneKey).toBe('tab-1:leaf-1')
    expect(solo?.subagents).toBe(2)
  })

  it('keeps the card for no agent, two agents, or a retained one', () => {
    expect(sidebarSoloAgentOf([])).toBeNull()
    expect(sidebarSoloAgentOf([rowOf('tab-1:leaf-1'), rowOf('tab-2:leaf-2')])).toBeNull()
    expect(sidebarSoloAgentOf([rowOf('tab-1:leaf-1', 'retained')])).toBeNull()
  })
})

describe('sidebarSoloRowLines', () => {
  it('shows the question in the question tone while the agent waits', () => {
    const entry = entryOf({
      state: 'waiting',
      toolName: 'AskUserQuestion',
      interactivePrompt: JSON.stringify({
        questions: [{ question: 'Apply the migration now?', options: [{ label: 'Now' }] }]
      })
    })
    expect(sidebarSoloRowLines(entry, OPTIONS).activity).toEqual({
      text: 'Apply the migration now?',
      asks: true
    })
  })

  it('names the tool while working, the last reply when done, the prompt when idle', () => {
    const working = entryOf({ toolName: 'Bash', toolInput: 'gh pr checks 912' })
    expect(sidebarSoloRowLines(working, OPTIONS).activity?.text).toContain('gh pr checks 912')
    expect(sidebarSoloRowLines(working, OPTIONS).activity?.asks).toBe(false)

    const done = entryOf({ state: 'done', lastAssistantMessage: 'Validation added, tests pass.' })
    expect(sidebarSoloRowLines(done, OPTIONS).activity?.text).toBe('Validation added, tests pass.')

    const idle = entryOf({ state: 'done', interrupted: true, prompt: 'Adjust the hero' })
    expect(sidebarSoloRowLines(idle, OPTIONS).activity?.text).toBe('Adjust the hero')
  })

  it('drops the activity line when Card display hides agent activity', () => {
    expect(sidebarSoloRowLines(entryOf(), { ...OPTIONS, properties: [] }).activity).toBeNull()
  })

  it('builds V30 extra line: repo when flat, remote host, subagents, then shown extras', () => {
    const extra = sidebarSoloRowLines(entryOf({ model: 'claude-opus-5-5' }), {
      properties: ['inline-agents', 'ports', 'account', 'model'],
      flat: true,
      repoName: 'cineco',
      remoteHost: 'imac',
      underHostHeader: false,
      subagents: 1,
      ports: [5173],
      account: 'fabiana@example.com'
    }).extra
    expect(extra).toBe('cineco · imac · 1 subagent · Ports 5173 · @fabiana · Opus 5.5')
  })

  it('drops the host under a host header, which already names it, and keeps the rest', () => {
    const lines = (underHostHeader: boolean): string | null =>
      sidebarSoloRowLines(entryOf(), {
        ...OPTIONS,
        flat: true,
        remoteHost: 'imac',
        underHostHeader,
        subagents: 1
      }).extra
    expect(lines(false)).toBe('orca-oss · imac · 1 subagent')
    expect(lines(true)).toBe('orca-oss · 1 subagent')
  })

  it('has no extra line for a local agent grouped by project', () => {
    expect(sidebarSoloRowLines(entryOf(), OPTIONS).extra).toBeNull()
  })

  it('never prints a non-email account label such as System default', () => {
    const extra = sidebarSoloRowLines(entryOf(), {
      ...OPTIONS,
      properties: ['account'],
      account: 'System default'
    }).extra
    expect(extra).toBeNull()
  })
})
