import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { TeamMemberCard } from '../../../../shared/team-panel-model-types'

vi.mock('@/i18n/i18n', () => ({
  translate: (_key: string, fallback: string, options?: Record<string, unknown>) =>
    fallback.replace(/\{\{(\w+)\}\}/g, (_, name: string) => String(options?.[name] ?? '')),
  getIntlLocale: () => 'en'
}))

let sidebar = { rightSidebarOpen: true, rightSidebarTab: 'team' }
let memberOfTab: TeamMemberCard | null = null
vi.mock('@/store', () => ({
  useAppStore: (selector: (state: typeof sidebar) => unknown) => selector(sidebar)
}))
vi.mock('./use-team-panel-model', () => ({ useTeamMemberOfTab: () => memberOfTab }))

const { TeamMemberPaneHeader } = await import('./TeamMemberPaneHeader')

function member(overrides: Partial<TeamMemberCard> = {}): TeamMemberCard {
  return {
    paneKey: 'tab-7:leaf',
    terminalHandle: 'term-7',
    worktreeId: 'wt-7',
    host: { kind: 'remote', name: 'imac', environmentId: 'env-1', reachable: true },
    name: 'Knight',
    agentType: 'claude',
    status: 'working',
    condition: 'working',
    since: null,
    liveAction: null,
    model: { label: 'Sonnet 5.5', effort: 'medium', source: 'launch' },
    account: null,
    characterKey: null,
    ticket: { identifier: 'ORCA-1044', title: null, url: null, statusGroup: null },
    flowPhase: null,
    summary: null,
    pr: {
      provider: 'github',
      number: 924,
      title: 'Remote member stays a member',
      url: 'https://example.test/pr/924',
      state: 'open',
      ci: 'failure',
      verdict: null,
      perfectMerge: null
    },
    needsYou: false,
    limitResetsAt: null,
    found: false,
    ...overrides
  }
}

const render = (): string => renderToStaticMarkup(<TeamMemberPaneHeader tabId="tab-7" />)

describe('TeamMemberPaneHeader', () => {
  beforeEach(() => {
    sidebar = { rightSidebarOpen: true, rightSidebarTab: 'team' }
    memberOfTab = member()
  })

  it("heads a member's terminal with its ticket, host, model and PR", () => {
    const markup = render()

    expect(markup).toContain('data-team-member-header')
    for (const text of [
      'Knight',
      'ORCA-1044',
      'imac',
      'Sonnet 5.5 · medium',
      '#924 · CI failing'
    ]) {
      expect(markup).toContain(text)
    }
    expect(markup).toContain('href="https://example.test/pr/924"')
    expect(markup).not.toContain('Waiting for you')
  })

  it('names a member launched by its ticket once', () => {
    memberOfTab = member({ name: 'ORCA-1044' })

    expect(render().match(/ORCA-1044/g)).toHaveLength(1)
  })

  it('says when the member waits for the user', () => {
    memberOfTab = member({ needsYou: true })

    expect(render()).toContain('Waiting for you')
  })

  it('draws nothing on a terminal that is not a member of the live team', () => {
    memberOfTab = null

    expect(render()).toBe('')
  })

  // Why: the model is read only while the panel is open; a closed panel would leave it stale.
  it('draws nothing once the Team panel is closed', () => {
    sidebar = { rightSidebarOpen: false, rightSidebarTab: 'team' }

    expect(render()).toBe('')
  })
})
