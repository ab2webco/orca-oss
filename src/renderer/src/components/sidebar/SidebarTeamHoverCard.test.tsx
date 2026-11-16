// @vitest-environment happy-dom

import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { TeamLeadCard, TeamMemberCard } from '../../../../shared/team-panel-model-types'
import { SidebarTeamHoverDetails } from './SidebarTeamHoverCard'

vi.mock('@/i18n/i18n', () => ({
  translate: (_key: string, fallback: string, options?: Record<string, unknown>) =>
    fallback.replace(/\{\{(\w+)\}\}/g, (_, name: string) => String(options?.[name] ?? '')),
  getIntlLocale: () => 'en'
}))

const lead: TeamLeadCard = {
  paneKey: 'pane-lead',
  terminalHandle: 'term-lead',
  worktreeId: 'wt-main',
  host: { kind: 'local' },
  name: 'Castle',
  agentType: 'claude',
  status: 'working',
  condition: 'working',
  since: null,
  liveAction: { kind: 'tool', tool: 'Bash', detail: 'gh pr checks 912' },
  model: { label: 'Opus 5.5', effort: 'high', source: 'session' },
  account: { provider: 'claude', email: 'lead@example.test', usedPercent: null },
  characterKey: 'hero',
  branch: 'refs/heads/main',
  ownerAsk: null
}

function member(overrides: Partial<TeamMemberCard> = {}): TeamMemberCard {
  return {
    paneKey: 'pane-m',
    terminalHandle: 'term-m',
    worktreeId: 'wt-m',
    host: { kind: 'remote', name: 'm1', environmentId: 'env-1', reachable: true },
    name: 'Smith',
    agentType: 'claude',
    status: 'working',
    condition: 'working',
    since: null,
    liveAction: { kind: 'tool', tool: 'Edit', detail: 'tooltip.tsx' },
    model: { label: 'Sonnet 5.5', effort: 'medium', source: 'session' },
    account: { provider: 'claude', email: 'fabiana@example.test', usedPercent: null },
    characterKey: null,
    ticket: { identifier: 'ORCA-1012', title: 'Fix the tooltip', url: null, statusGroup: null },
    flowPhase: null,
    summary: null,
    pr: {
      provider: 'github',
      number: 930,
      title: 'Tooltip',
      url: 'https://example.test/pr/930',
      state: 'open',
      ci: 'success',
      verdict: null,
      perfectMerge: null
    },
    needsYou: false,
    limitResetsAt: null,
    found: false,
    ...overrides
  }
}

const roots: ReturnType<typeof createRoot>[] = []
afterEach(async () => {
  await act(async () => {
    for (const root of roots.splice(0)) {
      root.unmount()
    }
  })
  document.body.innerHTML = ''
})

async function render(element: React.JSX.Element): Promise<HTMLElement> {
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  roots.push(root)
  await act(async () => root.render(element))
  return host
}

function readCard(host: HTMLElement) {
  return {
    title: host.querySelector('[data-team-hover-title]')?.textContent ?? null,
    subtitle: host.querySelector('[data-team-hover-subtitle]')?.textContent ?? null,
    rows: [...host.querySelectorAll('dt')].map((dt) => [
      dt.textContent,
      dt.nextElementSibling?.textContent
    ])
  }
}

describe('SidebarTeamHoverDetails (V30 hoverHtml)', () => {
  it("reads a member's card: name and ticket, task title, then Now, Model, Account, PR and Host", async () => {
    const host = await render(
      <SidebarTeamHoverDetails
        row={{ role: 'member', card: member() }}
        look="game"
        repoName="orca-oss"
        localHostName={null}
      />
    )
    expect(readCard(host)).toEqual({
      title: 'Smith · ORCA-1012',
      subtitle: 'Fix the tooltip',
      rows: [
        ['Now', 'Edit · tooltip.tsx'],
        ['Model', 'Sonnet 5.5 · medium'],
        ['Account', 'fabiana@example.test'],
        ['PR', '#930 · CI green'],
        ['Host', 'm1']
      ]
    })
  })

  it('names a member by its ticket in plain mode and drops what it does not know', async () => {
    const card = member({
      ticket: { identifier: 'ORCA-1012', title: null, url: null, statusGroup: null },
      model: null,
      account: null,
      pr: null
    })
    const host = await render(
      <SidebarTeamHoverDetails
        row={{ role: 'member', card }}
        look="plain"
        repoName="orca-oss"
        localHostName={null}
      />
    )
    expect(readCard(host)).toEqual({
      title: 'ORCA-1012',
      subtitle: null,
      rows: [
        ['Now', 'Edit · tooltip.tsx'],
        ['Host', 'm1']
      ]
    })
  })

  it('marks Now in the question tone while the member needs you', async () => {
    const card = member({ status: 'attention', needsYou: true, condition: 'waiting' })
    const host = await render(
      <SidebarTeamHoverDetails
        row={{ role: 'member', card }}
        look="game"
        repoName="orca-oss"
        localHostName={null}
      />
    )
    const now = host.querySelector('dd[data-asks]')
    expect(now?.textContent).toBe('Waiting for your answer')
  })

  it("reads the lead's card: name and branch, repo and machine, then Now, Model and Account", async () => {
    const host = await render(
      <SidebarTeamHoverDetails
        row={{ role: 'lead', card: lead }}
        look="game"
        repoName="orca-oss"
        localHostName="Mac de Fabian"
      />
    )
    expect(readCard(host)).toEqual({
      title: 'Castle · main',
      subtitle: 'orca-oss · Mac de Fabian',
      rows: [
        ['Now', 'Orchestrating · Bash · gh pr checks 912'],
        ['Model', 'Opus 5.5 · high'],
        ['Account', 'lead@example.test']
      ]
    })
  })

  it('calls the lead by its role in plain mode', async () => {
    const host = await render(
      <SidebarTeamHoverDetails
        row={{ role: 'lead', card: lead }}
        look="plain"
        repoName={null}
        localHostName="Mac de Fabian"
      />
    )
    expect(readCard(host).title).toBe('Lead · main')
    expect(readCard(host).subtitle).toBe('Mac de Fabian')
  })
})
