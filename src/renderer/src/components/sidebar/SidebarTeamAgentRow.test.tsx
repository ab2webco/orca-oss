// @vitest-environment happy-dom

import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type {
  TeamLeadCard,
  TeamMemberCard,
  TeamPanelGameModel
} from '../../../../shared/team-panel-model-types'
import { teamRowOfWorktree } from './sidebar-team-roster'
import { SidebarTeamAgentRow } from './SidebarTeamAgentRow'

vi.mock('@/i18n/i18n', () => ({
  translate: (_key: string, fallback: string, options?: Record<string, unknown>) =>
    fallback.replace(/\{\{(\w+)\}\}/g, (_, name: string) => String(options?.[name] ?? '')),
  getIntlLocale: () => 'en'
}))

const NOW = Date.UTC(2026, 10, 9, 12, 0, 0)

const lead: TeamLeadCard = {
  paneKey: 'pane-lead',
  terminalHandle: 'term-lead',
  worktreeId: 'wt-main',
  host: { kind: 'local' },
  name: 'Castle',
  agentType: 'claude',
  status: 'working',
  condition: 'working',
  since: NOW - 13 * 3_600_000,
  liveAction: null,
  model: null,
  account: null,
  characterKey: 'hero',
  branch: 'main',
  ownerAsk: null
}

function member(overrides: Partial<TeamMemberCard> = {}): TeamMemberCard {
  return {
    paneKey: 'pane-m',
    terminalHandle: 'term-m',
    worktreeId: 'wt-m',
    host: { kind: 'local' },
    name: 'Squire',
    agentType: 'claude',
    status: 'working',
    condition: 'working',
    since: NOW - 4 * 60_000,
    liveAction: null,
    model: null,
    account: null,
    characterKey: null,
    ticket: {
      identifier: 'ORCA-1034',
      title: null,
      url: null,
      statusGroup: null
    },
    flowPhase: null,
    summary: null,
    pr: null,
    needsYou: false,
    limitResetsAt: null,
    found: false,
    ...overrides
  }
}

const model = (members: TeamMemberCard[]): Pick<TeamPanelGameModel, 'lead' | 'members'> => ({
  lead,
  members
})

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

describe('teamRowOfWorktree', () => {
  it('finds the lead and a member by their worktree', () => {
    const squire = member()
    expect(teamRowOfWorktree(model([squire]), 'wt-main')).toEqual({
      role: 'lead',
      card: lead
    })
    expect(teamRowOfWorktree(model([squire]), 'wt-m')).toEqual({
      role: 'member',
      card: squire
    })
  })

  it('leaves a worktree outside the team as a plain card', () => {
    expect(teamRowOfWorktree(model([member()]), 'wt-other')).toBeNull()
    expect(teamRowOfWorktree(null, 'wt-m')).toBeNull()
  })
})

describe('SidebarTeamAgentRow (V30 row)', () => {
  it('draws the state dot, the kind icon, the bold name and the age, in that order', async () => {
    const host = await render(
      <SidebarTeamAgentRow row={{ role: 'member', card: member() }} look="game" showPr now={NOW} />
    )
    const row = host.querySelector('[data-sidebar-team-row="member"]')!
    const parts = [...row.children].map((child) => child.getAttribute('data-team-row-part'))
    expect(parts).toEqual(['state', 'kind', 'name', 'age'])
    expect(
      row.querySelector('[data-team-row-part="state"] [data-status-glyph="spinner"]')
    ).not.toBeNull()
    expect(row.querySelector('[data-team-row-part="kind"]')!.getAttribute('data-kind')).toBe(
      'branch'
    )
    const name = row.querySelector('[data-team-row-part="name"]')!
    expect(name.querySelector('b')!.textContent).toBe('Squire')
    expect(name.querySelector('[data-team-row-ticket]')!.textContent).toBe('ORCA-1034')
    expect(row.querySelector('[data-team-row-part="age"]')!.textContent).toBe('4 min')
  })

  it('shows the PR icon coloured by CI when the member has a PR', async () => {
    const pr = {
      provider: 'github' as const,
      number: 923,
      title: 'Logins',
      url: 'https://example.test/pr/923',
      state: 'open' as const,
      ci: 'success' as const,
      verdict: null,
      perfectMerge: null
    }
    const host = await render(
      <SidebarTeamAgentRow
        row={{ role: 'member', card: member({ pr }) }}
        look="game"
        showPr
        now={NOW}
      />
    )
    const kind = host.querySelector('[data-team-row-part="kind"]')!
    expect(kind.getAttribute('data-kind')).toBe('pr')
    expect(kind.getAttribute('data-ci-tone')).toBe('success')
  })

  it('keeps the branch icon when the card display hides PR links', async () => {
    const pr = {
      provider: 'github' as const,
      number: 923,
      title: 'Logins',
      url: 'https://example.test/pr/923',
      state: 'open' as const,
      ci: 'failure' as const,
      verdict: null,
      perfectMerge: null
    }
    const host = await render(
      <SidebarTeamAgentRow
        row={{ role: 'member', card: member({ pr }) }}
        look="game"
        showPr={false}
        now={NOW}
      />
    )
    expect(host.querySelector('[data-team-row-part="kind"]')!.getAttribute('data-kind')).toBe(
      'branch'
    )
  })

  it('names a member by its ticket only in plain mode', async () => {
    const host = await render(
      <SidebarTeamAgentRow row={{ role: 'member', card: member() }} look="plain" showPr now={NOW} />
    )
    const name = host.querySelector('[data-team-row-part="name"]')!
    expect(name.querySelector('b')!.textContent).toBe('ORCA-1034')
    expect(name.querySelector('[data-team-row-ticket]')).toBeNull()
  })

  it('marks a member that needs you with the question glyph', async () => {
    const host = await render(
      <SidebarTeamAgentRow
        row={{
          role: 'member',
          card: member({ status: 'attention', needsYou: true })
        }}
        look="game"
        showPr
        now={NOW}
      />
    )
    expect(host.querySelector('[data-status-glyph="question"]')).not.toBeNull()
  })

  it('crowns the lead and prints its branch beside the name', async () => {
    const host = await render(
      <SidebarTeamAgentRow row={{ role: 'lead', card: lead }} look="game" showPr now={NOW} />
    )
    const row = host.querySelector('[data-sidebar-team-row="lead"]')!
    const name = row.querySelector('[data-team-row-part="name"]')!
    expect(name.querySelector('[data-game-lead-crown]')).not.toBeNull()
    expect(name.querySelector('b')!.textContent).toBe('Castle')
    expect(name.querySelector('[data-team-row-ticket]')!.textContent).toBe('main')
    expect(row.querySelector('[data-team-row-part="age"]')!.textContent).toBe('13 h')
  })

  it('calls the lead by its role in plain mode', async () => {
    const host = await render(
      <SidebarTeamAgentRow row={{ role: 'lead', card: lead }} look="plain" showPr now={NOW} />
    )
    expect(host.querySelector('[data-team-row-part="name"] b')!.textContent).toBe('Lead')
  })
})
