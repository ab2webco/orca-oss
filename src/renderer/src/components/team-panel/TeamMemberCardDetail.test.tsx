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

  it('lists branch, model and effort, step, time in state and host, branch and model in mono', async () => {
    const container = await render(card())
    expect(text(container, '[data-team-detail="branch"] dd')).toBe('netsa-121-auth')
    expect(container.querySelector('[data-team-detail="branch"] dd code')).toBeTruthy()
    expect(text(container, '[data-team-detail="model"] dd')).toBe('Opus 5.5 · high')
    expect(container.querySelector('[data-team-detail="model"] dd code')).toBeTruthy()
    expect(text(container, '[data-team-detail="step"] dd')).toContain('pnpm test')
    expect(text(container, '[data-team-detail="since"] dd')).toBe('25 min')
    expect(text(container, '[data-team-detail="host"] dd')).toBe('local')
  })

  it('leaves out a fact it does not have instead of showing a blank', async () => {
    const container = await render(card({ branch: null, model: null, since: null }))
    expect(container.querySelector('[data-team-detail="branch"]')).toBeNull()
    expect(container.querySelector('[data-team-detail="model"]')).toBeNull()
    expect(container.querySelector('[data-team-detail="since"]')).toBeNull()
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
    expect(text(container, '[data-team-account]')).toContain('dev@example.com')
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
})
