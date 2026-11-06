import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import type { DashboardAgentRow } from '@/components/dashboard/useDashboardData'
import type { AgentStatusEntry } from '../../../../shared/agent-status-types'
import { CompactAgentRow } from './worktree-card-compact-agent-row'

vi.mock('@/store', () => ({
  useAppStore: (select: (s: unknown) => unknown) => select({ settings: {}, cacheTimerByKey: {} })
}))
vi.mock('./AgentStallTimerControl', () => ({ AgentStallTimerControl: () => null }))

function agent(entry: Partial<AgentStatusEntry>): DashboardAgentRow {
  return {
    paneKey: 'tab-1:leaf-1',
    tab: { id: 'tab-1' },
    agentType: 'claude',
    rowSource: 'live',
    state: entry.state ?? 'working',
    startedAt: 0,
    entry: {
      state: 'working',
      prompt: 'Fix the tooltip in the checks panel',
      updatedAt: 1,
      stateStartedAt: 1,
      agentType: 'claude',
      model: 'claude-opus-5-5',
      paneKey: 'tab-1:leaf-1',
      stateHistory: [],
      ...entry
    }
  } as DashboardAgentRow
}

const render = (row: DashboardAgentRow, showModel = false): string =>
  renderToStaticMarkup(
    <CompactAgentRow agent={row} now={2} onActivate={() => {}} showModel={showModel} />
  )

describe('CompactAgentRow live line', () => {
  it('shows the live tool instead of the prompt while working', () => {
    const markup = render(agent({ toolName: 'Bash', toolInput: 'gh pr checks 912' }))
    expect(markup).toContain('Bash · gh pr checks 912')
    expect(markup).not.toContain('Fix the tooltip')
  })

  it('shows a blocked agent question in the attention tone', () => {
    const interactivePrompt = JSON.stringify({
      questions: [{ question: 'Apply the migration now?', options: [{ label: 'Now' }] }]
    })
    const markup = render(
      agent({ state: 'blocked', toolName: 'AskUserQuestion', interactivePrompt })
    )
    expect(markup).toContain('class="text-status-attention">Apply the migration now?')
  })

  it('keeps the prompt when the agent has no live action', () => {
    expect(render(agent({ state: 'done' }))).toContain('Fix the tooltip')
  })

  it('hides the model unless Card display shows it, and then reads it as a person would', () => {
    const row = agent({ toolName: 'Edit' })
    expect(render(row)).not.toContain('claude-opus-5-5')
    expect(render(row)).not.toContain('Opus 5.5')
    expect(render(row, true)).toContain('Opus 5.5')
    expect(render(row, true)).not.toContain('claude-opus-5-5')
  })
})
