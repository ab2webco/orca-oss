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

const { TeamTabContent } = await import('./TeamTabContent')

const roots: ReturnType<typeof createRoot>[] = []
afterEach(async () => {
  await act(async () => {
    for (const root of roots.splice(0)) {
      root.unmount()
    }
  })
  document.body.innerHTML = ''
  openTeamSession.mockClear()
})

const lead = {
  paneKey: 'tab-lead:leaf',
  terminalHandle: 'term-lead',
  worktreeId: 'wt-main',
  host: { kind: 'local' },
  name: 'Castle',
  status: 'working',
  condition: 'idle',
  since: null,
  liveAction: null,
  model: { label: 'Opus 5.5', effort: 'high', source: 'session' },
  branch: 'fabolivark/orca-1300',
  ownerAsk: { ticket: 'ORCA-1044' },
  waitingOn: 2
} as unknown as TeamLeadCard

const knight = {
  paneKey: 'tab-7:leaf',
  terminalHandle: 'term-7',
  worktreeId: 'wt-7',
  host: { kind: 'local' },
  name: 'Knight',
  status: 'working',
  condition: 'working',
  since: null,
  liveAction: null,
  model: null,
  ticket: { identifier: 'ORCA-1044', title: null, url: null, statusGroup: null },
  pr: null,
  needsYou: false
} as unknown as TeamMemberCard

async function render(
  look: 'game' | 'plain',
  members: TeamMemberCard[] = [knight],
  selectTab = vi.fn()
): Promise<HTMLElement> {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  roots.push(root)
  const model = { kind: 'team', lead, advisor: null, members, xp: null, stopped: null }
  await act(async () => {
    root.render(
      <TeamTabContent
        model={model as unknown as TeamPanelGameModel}
        look={look}
        selectTab={selectTab}
        now={0}
        onOpenTasks={vi.fn()}
      />
    )
  })
  return container
}

const click = async (element: Element | null | undefined): Promise<void> => {
  expect(element).toBeTruthy()
  await act(async () => (element as HTMLElement).click())
}
const toggleOf = (container: HTMLElement, who: 'lead' | 'member'): Element | null =>
  container.querySelector(`[data-team-card="${who}"] button[aria-expanded]`)
const terminalOf = (container: HTMLElement, who: 'lead' | 'member'): HTMLButtonElement =>
  container.querySelector(`[data-team-card="${who}"] [data-team-open-terminal]`)!

describe('a Team card click expands it; its terminal icon opens the session', () => {
  it('expands a member card without opening its terminal, and folds it on a second click', async () => {
    const container = await render('plain')
    const card = toggleOf(container, 'member')

    await click(card)

    expect(openTeamSession).not.toHaveBeenCalled()
    expect(card?.getAttribute('aria-expanded')).toBe('true')
    expect(container.querySelector('[data-team-card-detail]')).toBeTruthy()

    await click(card)

    expect(card?.getAttribute('aria-expanded')).toBe('false')
    expect(openTeamSession).not.toHaveBeenCalled()
  })

  it("opens a member's terminal from its icon, by the name the card shows, and leaves it folded", async () => {
    const container = await render('plain')
    const icon = terminalOf(container, 'member')

    expect(icon.getAttribute('aria-label')).toBe('Open terminal')
    expect(icon.closest('button[aria-expanded]')).toBeNull()
    await click(icon)

    expect(openTeamSession).toHaveBeenCalledWith(knight, 'ORCA-1044')
    expect(toggleOf(container, 'member')?.getAttribute('aria-expanded')).toBe('false')
  })

  it('expands the lead card with what its model carries, without opening its terminal', async () => {
    const selectTab = vi.fn()
    const container = await render('game', [knight], selectTab)
    const card = toggleOf(container, 'lead')

    await click(card)

    expect(openTeamSession).not.toHaveBeenCalled()
    expect(card?.getAttribute('aria-expanded')).toBe('true')
    const detail = container.querySelector('[data-team-card="lead"] [data-team-card-detail]')!
    const fact = (key: string): string | null | undefined =>
      detail.querySelector(`[data-team-detail="${key}"] dd`)?.textContent
    expect(fact('status')).toBe('Idle')
    expect(fact('waitingOn')).toBe('2 agents')
    expect(fact('question')).toBe('Open, on ORCA-1044')
    expect(fact('host')).toBeTruthy()
    expect(fact('model')).toBe('Opus 5.5')
    expect(fact('effort')).toBe('high')
    expect(fact('branch')).toBe('fabolivark/orca-1300')

    const answer = [...detail.querySelectorAll('button')].find(
      (one) => one.textContent === 'Answer in Inbox'
    )
    await click(answer)
    expect(selectTab).toHaveBeenCalledWith('inbox')
  })

  it("opens the lead's terminal from its icon", async () => {
    const container = await render('game')

    await click(terminalOf(container, 'lead'))

    expect(openTeamSession).toHaveBeenCalledWith(lead, 'Castle')
  })

  it('keeps one card open at a time across the lead and members', async () => {
    const container = await render('plain')

    await click(toggleOf(container, 'lead'))
    await click(toggleOf(container, 'member'))

    expect(toggleOf(container, 'lead')?.getAttribute('aria-expanded')).toBe('false')
    expect(toggleOf(container, 'member')?.getAttribute('aria-expanded')).toBe('true')
  })

  it('shows the icon as unavailable, and opens nothing, for a session with no terminal', async () => {
    const container = await render('plain', [
      { ...knight, terminalHandle: null, worktreeId: null } as TeamMemberCard
    ])
    const icon = terminalOf(container, 'member')

    expect(icon.getAttribute('aria-disabled')).toBe('true')
    // Why dark too: ghost's dark:hover:bg-accent/50 outranks a bare hover:bg-transparent.
    expect(icon.className.split(' ')).toEqual(
      expect.arrayContaining(['hover:bg-transparent', 'dark:hover:bg-transparent'])
    )
    await click(icon)

    expect(openTeamSession).not.toHaveBeenCalled()
  })
})
