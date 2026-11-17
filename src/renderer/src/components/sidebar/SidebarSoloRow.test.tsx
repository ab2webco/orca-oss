// @vitest-environment happy-dom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { DashboardAgentRow } from '@/components/dashboard/useDashboardData'
import type { AgentStatusEntry } from '../../../../shared/agent-status-types'
import { SidebarSoloRow, type SidebarSoloRowProps } from './SidebarSoloRow'

vi.mock('@/i18n/i18n', () => ({
  translate: (_key: string, fallback: string, options?: Record<string, unknown>) =>
    fallback.replace(/\{\{(\w+)\}\}/g, (_, name: string) => String(options?.[name] ?? '')),
  getIntlLocale: () => 'en'
}))

const NOW = Date.UTC(2026, 10, 16, 12, 0, 0)

function agentOf(patch: Partial<AgentStatusEntry> = {}): DashboardAgentRow {
  const entry: AgentStatusEntry = {
    state: 'working',
    prompt: 'Review the merge queue',
    updatedAt: NOW,
    stateStartedAt: NOW - 8 * 60_000,
    paneKey: 'tab-1:leaf-1',
    stateHistory: [],
    ...patch
  }
  return {
    paneKey: entry.paneKey,
    entry,
    tab: { id: 'tab-1' } as DashboardAgentRow['tab'],
    agentType: 'claude',
    rowSource: 'live',
    state: entry.state,
    startedAt: entry.stateStartedAt
  }
}

let root: Root | null = null
let host: HTMLDivElement | null = null

function render(patch: Partial<SidebarSoloRowProps> = {}): HTMLDivElement {
  host = document.createElement('div')
  document.body.appendChild(host)
  const props: SidebarSoloRowProps = {
    agent: agentOf(),
    name: 'fix-tooltip',
    pr: null,
    now: NOW,
    lines: { activity: { text: 'Bash · gh pr checks 912', asks: false }, extra: 'orca-oss' },
    onActivate: vi.fn(),
    onDismiss: vi.fn(),
    ...patch
  }
  root = createRoot(host)
  act(() => root?.render(<SidebarSoloRow {...props} />))
  return host
}

afterEach(() => {
  act(() => root?.unmount())
  host?.remove()
  root = null
  host = null
})

const part = (el: HTMLElement, name: string): HTMLElement | null =>
  el.querySelector(`[data-team-row-part="${name}"]`)

describe('SidebarSoloRow', () => {
  it('draws V30 soloRow: state, branch icon, name, age and both lines', () => {
    const el = render()
    expect(el.querySelector('[data-sidebar-solo-row]')).not.toBeNull()
    expect(part(el, 'state')?.querySelector('[data-status-glyph="spinner"]')).not.toBeNull()
    expect(part(el, 'kind')?.dataset.kind).toBe('branch')
    expect(part(el, 'name')?.textContent).toBe('fix-tooltip')
    expect(part(el, 'age')?.textContent).toBe('8 min')
    expect(part(el, 'act')?.textContent).toBe('Bash · gh pr checks 912')
    expect(part(el, 'extra')?.textContent).toBe('orca-oss')
  })

  it('marks a waiting agent with the question glyph and its line with the question tone', () => {
    const el = render({
      agent: agentOf({ state: 'waiting' }),
      lines: { activity: { text: 'Apply it now?', asks: true }, extra: null }
    })
    expect(part(el, 'state')?.querySelector('[data-status-glyph="question"]')).not.toBeNull()
    expect(part(el, 'act')?.hasAttribute('data-asks')).toBe(true)
    expect(part(el, 'extra')).toBeNull()
  })

  it('draws the PR icon in its CI tone when the worktree has a PR', () => {
    const el = render({ pr: { state: 'open', ci: 'success' } })
    expect(part(el, 'kind')?.dataset.kind).toBe('pr')
    expect(part(el, 'kind')?.dataset.ciTone).toBe('success')
  })

  it('focuses the agent pane on click, as the inline list row did', () => {
    const onActivate = vi.fn()
    const el = render({ onActivate })
    act(() => el.querySelector<HTMLElement>('[data-sidebar-solo-row]')?.click())
    expect(onActivate).toHaveBeenCalledWith('tab-1', 'tab-1:leaf-1')
  })

  it('dismisses the agent from its hover X without focusing it', () => {
    const onActivate = vi.fn()
    const onDismiss = vi.fn()
    const el = render({ onActivate, onDismiss })
    act(() => el.querySelector<HTMLElement>('[aria-label="Dismiss agent"]')?.click())
    expect(onDismiss).toHaveBeenCalledWith('tab-1:leaf-1')
    expect(onActivate).not.toHaveBeenCalled()
  })

  it('becomes the send target picker while a prompt waits for a target', () => {
    const onActivate = vi.fn()
    const onSendTargetClick = vi.fn()
    const el = render({ onActivate, onSendTargetClick, sendTargetStatus: 'eligible' })
    act(() => el.querySelector<HTMLElement>('[aria-label="Send to this agent"]')?.click())
    expect(onSendTargetClick).toHaveBeenCalledWith('tab-1:leaf-1')
    act(() => el.querySelector<HTMLElement>('[data-sidebar-solo-row]')?.click())
    expect(onSendTargetClick).toHaveBeenCalledTimes(2)
    expect(onActivate).not.toHaveBeenCalled()
  })
})
