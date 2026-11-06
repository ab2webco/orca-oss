// @vitest-environment happy-dom

import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { TeamActivityRow, TeamPanelSoloModel } from '../../../../shared/team-panel-model-types'
import { TooltipProvider } from '@/components/ui/tooltip'
import { TeamPanelActivityTab } from './team-panel-activity-tab'

vi.mock('@/i18n/i18n', () => ({
  translate: (_key: string, fallback: string, options?: Record<string, unknown>) =>
    fallback.replace(/\{\{(\w+)\}\}/g, (_, name: string) => String(options?.[name] ?? '')),
  getIntlLocale: () => 'en'
}))

const settings = { pluginSystemEnabled: false, promptCacheTtlMs: 300_000 }
vi.mock('@/store', () => ({
  useAppStore: (select: (s: unknown) => unknown) => select({ settings })
}))

const openTeamSession = vi.fn()
vi.mock('./team-panel-open-session', () => ({
  openTeamSession: (ref: unknown) => openTeamSession(ref)
}))

const roots: ReturnType<typeof createRoot>[] = []

afterEach(async () => {
  await act(async () => {
    for (const root of roots.splice(0)) {
      root.unmount()
    }
  })
  document.body.innerHTML = ''
  settings.pluginSystemEnabled = false
  openTeamSession.mockReset()
})

function row(overrides: Partial<TeamActivityRow>): TeamActivityRow {
  return {
    paneKey: 'tab-a:leaf-a',
    terminalHandle: null,
    worktreeId: 'wt-a',
    host: { kind: 'local' },
    name: 'main',
    agentType: 'claude',
    status: 'working',
    condition: 'working',
    since: Date.now() - 120_000,
    liveAction: { kind: 'tool', tool: 'Bash', detail: 'gh pr checks 912' },
    model: { label: 'Opus 5.5', effort: null, source: 'session' },
    account: { provider: 'claude', email: 'dev@example.com', usedPercent: null },
    repoName: 'orca-oss',
    worktreeName: 'main',
    isPrimary: true,
    prompt: 'Check the merge queue',
    ticket: null,
    pr: null,
    lastMessage: null,
    cacheExpiresAt: null,
    ports: [],
    note: null,
    subagentCount: 0,
    recentSteps: [],
    advisor: null,
    ...overrides
  }
}

function model(rows: TeamActivityRow[], selectedPaneKey: string | null): TeamPanelSoloModel {
  return {
    kind: 'solo',
    selectedPaneKey,
    rows,
    inbox: { kind: 'ready', value: { forYou: 0, waiting: 0, threads: 0, answered: 0 } },
    prs: null,
    queue: null,
    machines: null
  }
}

async function render(value: TeamPanelSoloModel): Promise<HTMLElement> {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  roots.push(root)
  await act(async () => {
    root.render(
      <TooltipProvider>
        <TeamPanelActivityTab value={value} model={value} selectTab={() => {}} />
      </TooltipProvider>
    )
  })
  return host
}

const blocked = row({
  paneKey: 'tab-b:leaf-b',
  worktreeId: 'wt-b',
  worktreeName: 'fix-tooltip',
  status: 'attention',
  condition: 'waiting',
  liveAction: { kind: 'question', text: 'Apply the migration now?', options: ['Now', 'Later'] }
})

describe('TeamPanelActivityTab', () => {
  it('opens on the selected session with its live action, model and account', async () => {
    const host = await render(model([row({})], 'tab-a:leaf-a'))
    const selected = host.querySelector('[data-team-activity="selected"]')
    expect(selected?.textContent).toContain('Bash · gh pr checks 912')
    expect(selected?.textContent).toContain('Check the merge queue')
    expect(selected?.textContent).toContain('Opus 5.5')
    expect(selected?.textContent).toContain('dev@example.com')
    // One session: no count line and no other sessions.
    expect(host.querySelector('[data-team-activity-count]')).toBeNull()
    expect(host.querySelectorAll('[data-team-activity="other"]')).toHaveLength(0)
  })

  it('shows a blocked session question and lists other sessions only when they exist', async () => {
    const host = await render(model([blocked, row({})], 'tab-b:leaf-b'))
    const selected = host.querySelector('[data-team-activity="selected"]')
    expect(selected?.getAttribute('data-pane-key')).toBe('tab-b:leaf-b')
    expect(selected?.querySelector('dd.text-status-attention')?.textContent).toBe(
      'Apply the migration now?'
    )
    const others = host.querySelectorAll('[data-team-activity="other"]')
    expect(others).toHaveLength(1)
    expect(others[0]?.textContent).toContain('Bash · gh pr checks 912')
    expect(host.querySelector('[data-team-activity-count]')?.textContent).toBe(
      '1 needs you1 working'
    )
  })

  it('opens another session in the center when it is pressed', async () => {
    const host = await render(model([blocked, row({})], 'tab-b:leaf-b'))
    await act(async () => {
      ;(host.querySelector('[data-team-activity="other"]') as HTMLButtonElement).click()
    })
    expect(openTeamSession).toHaveBeenCalledWith(
      expect.objectContaining({ paneKey: 'tab-a:leaf-a', worktreeId: 'wt-a' })
    )
  })

  it('shows the Jev section only with the plugin system on', async () => {
    const advisor = {
      model: 'Sonnet 5.5',
      effort: 'medium',
      pinned: { model: true, effort: false },
      line: null,
      previous: { model: 'Opus 5.5', effort: null },
      calls: [{ agent: 'Explore', model: 'Haiku 5.5', verdict: 'approved' }]
    }
    const off = await render(model([row({ advisor })], null))
    expect(off.querySelector('[data-team-activity-advisor]')).toBeNull()
    settings.pluginSystemEnabled = true
    const on = await render(model([row({ advisor })], null))
    const jev = on.querySelector('[data-team-activity-advisor]')
    expect(jev?.textContent).toContain('Opus 5.5 → Sonnet 5.5')
    expect(jev?.textContent).toContain('Haiku 5.5 · approved')
  })

  it('shows the cache countdown only when the row carries one', async () => {
    const without = await render(model([row({})], null))
    expect(without.textContent).not.toContain('Cache')
    const withCache = await render(model([row({ cacheExpiresAt: Date.now() + 120_000 })], null))
    expect(withCache.textContent).toContain('Cache')
  })
})
