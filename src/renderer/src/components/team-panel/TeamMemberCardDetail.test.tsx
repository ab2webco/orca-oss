// @vitest-environment happy-dom

import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { TeamMemberCard } from '../../../../shared/team-panel-model-types'

vi.mock('@/i18n/i18n', () => ({
  translate: (_key: string, fallback: string, options?: Record<string, unknown>) =>
    fallback.replace(/\{\{(\w+)\}\}/g, (_, name: string) => String(options?.[name] ?? '')),
  getIntlLocale: () => 'en'
}))

const { useAppStore } = await import('@/store')
const { TeamMemberCardDetail } = await import('./TeamMemberCardDetail')

const MINUTE = 60_000
const NOW = 1_000_000_000

const card = (over: Partial<TeamMemberCard> = {}): TeamMemberCard => ({
  paneKey: 'tab-7:leaf',
  terminalHandle: 'term-7',
  worktreeId: 'wt-7',
  host: { kind: 'local' },
  name: 'Knight',
  agentType: 'claude',
  status: 'working',
  condition: 'working',
  since: NOW - 25 * MINUTE,
  liveAction: { kind: 'tool', tool: 'Bash', detail: 'pnpm test' },
  model: { label: 'Opus 5.5', effort: 'high', source: 'launch' },
  account: { provider: 'claude', email: 'dev@example.com', id: 'a1', usedPercent: 3 },
  characterKey: null,
  ticket: { identifier: 'NETSA-121', title: 'Sign in with SSO', url: null, statusGroup: null },
  branch: 'netsa-121-auth',
  flowPhase: 'code',
  summary: 'Re: Question',
  pr: {
    provider: 'github',
    number: 924,
    title: 'SSO sign-in',
    url: 'https://github.com/o/r/pull/924',
    state: 'open',
    ci: 'success',
    verdict: null,
    perfectMerge: null
  },
  needsYou: false,
  limitResetsAt: null,
  found: false,
  ...over
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

async function render(member: TeamMemberCard): Promise<HTMLElement> {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  roots.push(root)
  await act(async () => {
    root.render(<TeamMemberCardDetail card={member} now={NOW} answer={null} />)
  })
  return container
}

const text = (container: HTMLElement, selector: string): string | null =>
  container.querySelector(selector)?.textContent ?? null

describe('TeamMemberCardDetail', () => {
  it("heads the open card with the ticket's title, never the last message's subject", async () => {
    const container = await render(card())
    expect(text(container, '[data-team-card-title]')).toBe('Sign in with SSO')
    expect(container.textContent).not.toContain('Re: Question')
  })

  it('falls back to the PR title when the ticket has none', async () => {
    const container = await render(
      card({ ticket: { identifier: 'NETSA-121', title: null, url: null, statusGroup: null } })
    )
    expect(text(container, '[data-team-card-title]')).toBe('SSO sign-in')
  })

  it('lists only what the card header lacks: the branch in mono, and the last tool', async () => {
    const container = await render(card())
    const facts = [...container.querySelectorAll('[data-team-detail]')].map((one) =>
      one.getAttribute('data-team-detail')
    )
    // Why not model, phase, time or host: the header above already shows each once (owner).
    expect(facts).toEqual(['branch', 'tool'])
    expect(container.querySelector('[data-team-detail="branch"] dd code')).toBeTruthy()
    expect(text(container, '[data-team-detail="tool"] dd')).toContain('pnpm test')
  })

  it('cuts a long branch in the middle, keeping the ticket part whole', async () => {
    const container = await render(card({ branch: 'fabolivark/netsa-121-auth' }))
    const parts = [...container.querySelectorAll('[data-team-detail="branch"] dd code > span')]
    expect(parts.map((one) => one.textContent)).toEqual(['fabolivark/', 'netsa-121-auth'])
  })

  it('leaves out a fact it does not have instead of showing a blank', async () => {
    const container = await render(card({ branch: null, liveAction: null }))
    expect(container.querySelector('[data-team-detail="branch"]')).toBeNull()
    expect(container.querySelector('[data-team-detail="tool"]')).toBeNull()
  })

  it('shows the PR and its CI as one chip with the CI colour', async () => {
    const container = await render(card())
    const chip = container.querySelector('[data-team-pr-chip]')
    expect(chip?.textContent).toBe('#924 · CI green')
    expect(chip?.getAttribute('href')).toBe('https://github.com/o/r/pull/924')
    expect(chip?.querySelector('[data-status-tone]')).toBeTruthy()
  })

  it('draws the 5 h and week windows as bars with the time left, in the status bar words', async () => {
    const window = (usedPercent: number, windowMinutes: number, resetsAt: number) => ({
      usedPercent,
      windowMinutes,
      resetsAt,
      resetDescription: null
    })
    useAppStore.setState({
      usagePercentageDisplay: 'remaining',
      rateLimits: {
        ...useAppStore.getState().rateLimits,
        inactiveClaudeAccounts: [
          {
            accountId: 'a1',
            updatedAt: 1,
            isFetching: false,
            rateLimits: {
              provider: 'claude',
              session: window(20, 300, NOW + 79 * MINUTE),
              weekly: window(12, 10080, NOW + (5 * 24 + 12) * 60 * MINUTE),
              updatedAt: 1,
              error: null,
              status: 'ok'
            }
          }
        ]
      }
    })
    const container = await render(card())
    // Why the provider: the bars measure that provider's windows, which the agent's model runs on.
    expect(text(container, '[data-team-account-label]')).toBe('Claude · dev@example.com')
    // One grid: a label column, a bar column of one width with a visible track, a value column.
    const grid = container.querySelector('[data-team-usage-grid]')
    expect(grid?.querySelectorAll('[data-team-usage-track]')).toHaveLength(2)
    // A meter with a name, so the reading is never colour alone.
    const meter = container.querySelector('[data-team-usage="session"] [role="meter"]')
    expect(meter?.getAttribute('aria-valuenow')).toBe('20')
    expect(meter?.getAttribute('aria-label')).toBe('5 h')
    expect(text(container, '[data-team-usage="session"]')).toContain('80% left')
    expect(text(container, '[data-team-usage="session"]')).toContain('1h 19m')
    expect(text(container, '[data-team-usage="weekly"]')).toContain('88% left')
    expect(text(container, '[data-team-usage="weekly"]')).toContain('5d 12h')
    expect(
      (container.querySelector('[data-team-usage="session"] [data-team-usage-fill]') as HTMLElement)
        ?.style.width
    ).toBe('80%')
  })

  it("falls back to the game's 5 h reading, with no time left, for an account this host does not read", async () => {
    useAppStore.setState({ usagePercentageDisplay: 'used' })
    const container = await render(
      card({ account: { provider: 'claude', email: 'far@example.com', id: 'zz', usedPercent: 20 } })
    )
    expect(text(container, '[data-team-usage="session"]')).toContain('20% used')
    expect(text(container, '[data-team-usage="session"]')).not.toContain('·')
    expect(container.querySelector('[data-team-usage="weekly"]')).toBeNull()
  })

  it("names a Codex member's account by its provider", async () => {
    const container = await render(
      card({ account: { provider: 'codex', email: 'dev@example.com', id: 'c1', usedPercent: 5 } })
    )
    expect(text(container, '[data-team-account-label]')).toBe('Codex · dev@example.com')
  })
})

describe('TeamMemberCardDetail helpers', () => {
  afterEach(() => {
    useAppStore.setState({ agentStatusByPaneKey: {} })
  })

  it("lists one line per helper the member's session runs, with its description and state", async () => {
    useAppStore.setState({
      agentStatusByPaneKey: {
        'tab-7:leaf': {
          subagents: [
            { id: 'a1', description: 'Map sidebar rows', state: 'working', startedAt: 1 },
            { id: 'a2', agentType: 'Explore', state: 'idle', startedAt: 2 }
          ]
        }
      } as never
    })
    const container = await render(card())
    const lines = [...container.querySelectorAll('[data-team-helper]')].map(
      (one) => one.textContent
    )
    expect(lines).toEqual(['Map sidebar rowsWorking', 'ExploreDone'])
  })

  it('shows no helper lines when the session runs none', async () => {
    const container = await render(card())
    expect(container.querySelector('[data-team-helper]')).toBeNull()
  })
})
