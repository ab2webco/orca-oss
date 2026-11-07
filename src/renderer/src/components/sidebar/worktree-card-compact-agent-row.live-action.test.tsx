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

const CAPABILITY = `dcap_${'A'.repeat(43)}`

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

  it('adds the effort to the model, as Card display names it', () => {
    expect(render(agent({ toolName: 'Edit', effort: 'high' }), true)).toContain('Opus 5.5 · high')
  })

  it('names the tool a blocked agent waits on, in the attention tone, when it asked nothing', () => {
    const markup = render(agent({ state: 'blocked', toolName: 'Bash', toolInput: 'rm -rf dist' }))
    expect(markup).toContain('class="text-status-attention">Bash · rm -rf dist')
    expect(markup).not.toContain('Fix the tooltip')
  })

  it('keeps a dispatch capability off the live line and its tooltip', () => {
    const markup = render(agent({ toolName: 'Bash', toolInput: `send ${CAPABILITY}` }))
    expect(markup).toContain('Bash · send [redacted]')
    expect(markup).not.toContain('dcap_')
  })

  it('keeps it off a row with no live action, which reads the raw status', () => {
    const subagent = {
      ...agent({ toolName: 'Bash', toolInput: `send ${CAPABILITY}` }),
      rowSource: 'subagent'
    } as DashboardAgentRow
    const finished = agent({
      state: 'done',
      prompt: `Run with ${CAPABILITY}`,
      lastAssistantMessage: `Sent with ${CAPABILITY}`
    })
    expect(render(subagent)).toContain('Bash: send [redacted]')
    expect(render(subagent)).not.toContain('dcap_')
    expect(render(finished)).toContain('Run with [redacted]')
    expect(render(finished)).toContain('Sent with [redacted]')
    expect(render(finished)).not.toContain('dcap_')
  })
})
