// @vitest-environment happy-dom

import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type {
  TeamLeadCard,
  TeamMemberCard,
  TeamPanelGameModel
} from '../../../../shared/team-panel-model-types'

vi.mock('@/i18n/i18n', () => ({
  translate: (_key: string, fallback: string, options?: Record<string, unknown>) =>
    fallback.replace(/\{\{(\w+)\}\}/g, (_, name: string) => String(options?.[name] ?? '')),
  getIntlLocale: () => 'en'
}))
const openTeamSession = vi.hoisted(() => vi.fn(async () => {}))
vi.mock('./team-session-open', () => ({ openTeamSession }))

const { useAppStore } = await import('@/store')
const { TeamTabContent } = await import('./TeamTabContent')

const HINT = "Add the host's repository to this window to open its terminal."
const knownWorktree = useAppStore.getState().getKnownWorktreeById

const roots: ReturnType<typeof createRoot>[] = []
afterEach(async () => {
  await act(async () => {
    for (const root of roots.splice(0)) {
      root.unmount()
    }
  })
  document.body.innerHTML = ''
  openTeamSession.mockClear()
  useAppStore.setState({ getKnownWorktreeById: knownWorktree })
})

const lead = {
  paneKey: 'tab-lead:leaf',
  terminalHandle: 'term-lead',
  worktreeId: 'wt-main',
  host: { kind: 'local' },
  name: 'Castle',
  status: 'working',
  condition: 'working',
  since: null,
  liveAction: null,
  model: null
} as unknown as TeamLeadCard

const herrero = {
  paneKey: 'tab-21:leaf',
  terminalHandle: 'term-21',
  worktreeId: 'wt-host-21',
  host: { kind: 'remote', name: 'imac', environmentId: 'env-9', reachable: true },
  name: 'Herrero',
  status: 'idle',
  condition: 'idle',
  since: null,
  liveAction: null,
  model: null,
  ticket: { identifier: 'ORCA-21', title: null, url: null, statusGroup: null },
  pr: null,
  needsYou: false,
  ask: null
} as unknown as TeamMemberCard

async function expandRemoteCard(): Promise<HTMLElement> {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  roots.push(root)
  const model = { kind: 'team', lead, advisor: null, members: [herrero], xp: null, stopped: null }
  await act(async () => {
    root.render(
      <TeamTabContent
        model={model as unknown as TeamPanelGameModel}
        look="plain"
        selectTab={vi.fn()}
        now={0}
        onOpenTasks={vi.fn()}
      />
    )
  })
  const card = container.querySelector('[data-team-card="member"]') as HTMLElement
  await act(async () => (card.querySelector('button[aria-expanded]') as HTMLButtonElement).click())
  return card
}

const terminalIcon = (card: HTMLElement): HTMLButtonElement =>
  card.querySelector('[data-team-open-terminal]') as HTMLButtonElement

// Why (ORCA-851): opening a remote card raised an error toast when this window lacked the host's repo.
describe("a remote member's card", () => {
  it('shows the hint, and its terminal icon opens nothing, when this window lacks the host worktree', async () => {
    const card = await expandRemoteCard()

    expect(card.querySelector('[data-team-card-detail]')).not.toBeNull()
    expect(card.textContent).toContain(HINT)
    expect(terminalIcon(card).getAttribute('aria-disabled')).toBe('true')
    await act(async () => terminalIcon(card).click())
    expect(openTeamSession).not.toHaveBeenCalled()
  })

  it('opens its session from the terminal icon, with no hint, once this window holds that worktree', async () => {
    useAppStore.setState({
      getKnownWorktreeById: ((id: string) =>
        id === 'wt-host-21' ? { id } : undefined) as unknown as typeof knownWorktree
    })
    const card = await expandRemoteCard()

    expect(card.textContent).not.toContain(HINT)
    // Why: expanding alone must not reveal the remote terminal (ORCA-1300).
    expect(openTeamSession).not.toHaveBeenCalled()
    expect(terminalIcon(card).getAttribute('aria-disabled')).toBeNull()
    await act(async () => terminalIcon(card).click())
    expect(openTeamSession).toHaveBeenCalledWith(
      expect.objectContaining({ worktreeId: 'wt-host-21' }),
      'ORCA-21'
    )
  })
})
