import { describe, expect, it, vi } from 'vitest'
import type { TeamLeadCard, TeamMemberCard } from '../../../../shared/team-panel-model-types'
import type { WorktreeCardProperty } from '../../../../shared/types'
import { sidebarTeamRowLines } from './sidebar-team-row-lines'

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
  account: {
    provider: 'claude',
    email: 'lead@example.test',
    usedPercent: null
  },
  characterKey: 'hero',
  branch: 'main',
  ownerAsk: null
}

function member(overrides: Partial<TeamMemberCard> = {}): TeamMemberCard {
  return {
    paneKey: 'pane-m',
    terminalHandle: 'term-m',
    worktreeId: 'wt-m',
    host: {
      kind: 'remote',
      name: 'm1',
      environmentId: 'env-1',
      reachable: true
    },
    name: 'Squire',
    agentType: 'claude',
    status: 'working',
    condition: 'working',
    since: null,
    liveAction: { kind: 'tool', tool: 'Edit', detail: 'tooltip.tsx' },
    model: { label: 'Sonnet 5.5', effort: 'medium', source: 'session' },
    account: {
      provider: 'claude',
      email: 'fabiana@example.test',
      usedPercent: null
    },
    characterKey: null,
    ticket: {
      identifier: 'ORCA-1012',
      title: 'Fix the tooltip',
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

const ALL: WorktreeCardProperty[] = ['inline-agents', 'ports', 'account', 'model']
const base = {
  teamTabOpen: false,
  properties: ALL,
  flat: false,
  ports: [],
  localHostName: null
}

describe('sidebarTeamRowLines (V30 drawLeft)', () => {
  it('prints what a member does now while the Team tab is closed', () => {
    expect(sidebarTeamRowLines({ role: 'member', card: member() }, base).activity).toEqual({
      text: 'Edit · tooltip.tsx',
      asks: false
    })
  })

  it('drops the activity line while the Team tab is open, as the panel already shows it', () => {
    const lines = sidebarTeamRowLines(
      { role: 'member', card: member() },
      {
        ...base,
        teamTabOpen: true
      }
    )
    expect(lines.activity).toBeNull()
    expect(lines.extra).not.toBeNull()
  })

  it('drops the activity line when the card display hides agent activity', () => {
    const lines = sidebarTeamRowLines(
      { role: 'member', card: member() },
      {
        ...base,
        properties: ['account']
      }
    )
    expect(lines.activity).toBeNull()
  })

  it('marks the line red while the member needs you, without the question text', () => {
    const card = member({
      status: 'attention',
      needsYou: true,
      condition: 'waiting',
      liveAction: {
        kind: 'question',
        text: '¿Aplico la migración?',
        options: []
      }
    })
    expect(sidebarTeamRowLines({ role: 'member', card }, base).activity).toEqual({
      text: 'Waiting for your answer',
      asks: true
    })
  })

  it("says the lead's open question as its Team card does, in the question tone", () => {
    const card: TeamLeadCard = {
      ...lead,
      status: 'attention',
      ownerAsk: { ticket: 'ORCA-2003' }
    }
    expect(sidebarTeamRowLines({ role: 'lead', card }, base).activity).toEqual({
      text: 'Waiting for you · Question on ORCA-2003',
      asks: true
    })
    const unticketed = { ...card, ownerAsk: { ticket: null } }
    expect(sidebarTeamRowLines({ role: 'lead', card: unticketed }, base).activity).toEqual({
      text: 'Waiting for you',
      asks: true
    })
  })

  it('names a permission prompt instead of an answer the Inbox does not hold', () => {
    const card = member({
      status: 'attention',
      needsYou: true,
      condition: 'waiting',
      ask: { kind: 'permission', tool: 'Bash' },
      liveAction: null
    })
    expect(sidebarTeamRowLines({ role: 'member', card }, base).activity).toEqual({
      text: 'Permission prompt: Bash',
      asks: true
    })
  })

  it("says a stopped member's red CI instead of Idle", () => {
    const card = member({
      status: 'failed',
      condition: 'idle',
      liveAction: null,
      pr: {
        provider: 'github',
        number: 912,
        title: 'Fix the tooltip',
        url: 'https://example.test/pr/912',
        state: 'open',
        ci: 'failure',
        verdict: null,
        perfectMerge: null
      }
    })
    expect(sidebarTeamRowLines({ role: 'member', card }, base).activity).toEqual({
      text: 'CI failing',
      asks: true
    })
  })

  it('says what a lead whose turn ended waits on, as its Team card does', () => {
    const card: TeamLeadCard = { ...lead, condition: 'idle', liveAction: null, waitingOn: 2 }
    expect(sidebarTeamRowLines({ role: 'lead', card }, base).activity).toEqual({
      text: 'Waiting on 2 agents',
      asks: false
    })
  })

  it("leads the lead's line with its verb and never adds an extra line", () => {
    const lines = sidebarTeamRowLines({ role: 'lead', card: lead }, { ...base, flat: true })
    expect(lines.activity).toEqual({
      text: 'Orchestrating · Bash · gh pr checks 912',
      asks: false
    })
    expect(lines.extra).toBeNull()
  })

  it('builds the extra line from ports, account and model in V30 order', () => {
    const lines = sidebarTeamRowLines(
      { role: 'member', card: member() },
      {
        ...base,
        ports: [3000, 5173]
      }
    )
    expect(lines.extra).toBe('Ports 3000, 5173 · @fabiana · Sonnet 5.5 · medium')
  })

  it('names the host first only when the rows are not grouped by project', () => {
    const flat = sidebarTeamRowLines(
      { role: 'member', card: member() },
      {
        ...base,
        properties: [],
        flat: true
      }
    )
    expect(flat.extra).toBe('m1')
    const grouped = sidebarTeamRowLines(
      { role: 'member', card: member() },
      {
        ...base,
        properties: []
      }
    )
    expect(grouped.extra).toBeNull()
  })

  it("names this machine by the user's rename when flat", () => {
    const lines = sidebarTeamRowLines(
      { role: 'member', card: member({ host: { kind: 'local' } }) },
      {
        ...base,
        properties: [],
        flat: true,
        localHostName: 'Mac de Fabian'
      }
    )
    expect(lines.extra).toBe('Mac de Fabian')
  })

  it('leaves out what the card display hides or the member does not have', () => {
    const lines = sidebarTeamRowLines(
      { role: 'member', card: member({ account: null, model: null }) },
      {
        ...base,
        properties: ['inline-agents', 'account', 'model'],
        ports: [3000]
      }
    )
    expect(lines.extra).toBeNull()
  })
})
