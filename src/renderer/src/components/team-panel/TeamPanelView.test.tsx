// @vitest-environment happy-dom

import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type {
  TeamActivityRow,
  TeamLeadCard,
  TeamPanelGameModel,
  TeamPanelSoloModel,
  TeamStatus
} from '../../../../shared/team-panel-model-types'
import { TooltipProvider } from '@/components/ui/tooltip'
import { TeamPanelView, teamPanelSettingsRepoId } from './TeamPanelView'
import { useTeamPanelTabStore } from './team-panel-tab-store'
import type { TeamPanelModelSource } from './use-team-panel-model'
import type { TeamPanelLook } from './use-team-panel-look'

vi.mock('@/i18n/i18n', () => ({
  translate: (_key: string, fallback: string, options?: Record<string, unknown>) =>
    fallback.replace(/\{\{(\w+)\}\}/g, (_, name: string) => String(options?.[name] ?? ''))
}))

const roots: ReturnType<typeof createRoot>[] = []

afterEach(async () => {
  await act(async () => {
    for (const root of roots.splice(0)) {
      root.unmount()
    }
  })
  document.body.innerHTML = ''
  useTeamPanelTabStore.setState({ selected: null, shown: null })
})

const lead: TeamLeadCard = {
  paneKey: 'pane-lead',
  terminalHandle: null,
  worktreeId: null,
  host: { kind: 'local' },
  name: 'Lead',
  agentType: 'claude',
  status: 'working',
  condition: 'working',
  since: null,
  liveAction: null,
  model: null,
  account: null,
  characterKey: null,
  branch: null,
  ownerAsk: null
}

const game: TeamPanelGameModel = {
  kind: 'team',
  repoId: 'repo-1',
  projectName: 'orca-oss',
  lead,
  advisor: null,
  members: [],
  metrics: { kind: 'loading' },
  xp: null,
  arcade: null,
  stopped: null,
  actions: [],
  scene: { id: null, extensions: [] },
  inbox: {
    kind: 'ready',
    value: { forYou: 2, waiting: 0, threads: 0, answered: 0 }
  },
  prs: { kind: 'error', message: 'rate limited' },
  queue: { kind: 'ready', value: [] },
  machines: null
}

const sessionRow = (status: TeamStatus): TeamActivityRow => ({
  ...lead,
  status,
  repoName: 'orca-oss',
  worktreeName: 'main',
  isPrimary: false,
  prompt: null,
  ticket: null,
  pr: null,
  lastMessage: null,
  cacheExpiresAt: null,
  ports: [],
  note: null,
  subagentCount: 0,
  recentSteps: [],
  advisor: null
})

const solo: TeamPanelSoloModel = {
  kind: 'solo',
  selectedPaneKey: null,
  rows: [],
  inbox: { kind: 'loading' },
  prs: null,
  queue: null,
  machines: null
}

async function render(
  source: TeamPanelModelSource,
  onOpenSettings = vi.fn(),
  look: TeamPanelLook = 'plain'
) {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  roots.push(root)
  await act(async () => {
    root.render(
      <TooltipProvider>
        <TeamPanelView source={source} look={look} onOpenSettings={onOpenSettings} />
      </TooltipProvider>
    )
  })
  return { container, onOpenSettings }
}

const tabs = (container: HTMLElement): string[] =>
  [...container.querySelectorAll('[role="tab"]')].map((tab) => tab.textContent ?? '')
const selectedTab = (container: HTMLElement): string | null =>
  container.querySelector('[role="tab"][aria-selected="true"]')?.textContent ?? null
const panelText = (container: HTMLElement): string =>
  container.querySelector('[role="tabpanel"]')?.textContent ?? ''

describe('TeamPanelView', () => {
  it('names the project and lists the tabs the model shows, with the Inbox count', async () => {
    const { container } = await render({
      section: { kind: 'ready', value: game },
      retry: null
    })

    expect(container.querySelector('h2')?.textContent).toBe('orca-oss')
    expect(tabs(container)).toEqual(['Team', 'Inbox2', 'PRs', 'Queue'])
    expect(selectedTab(container)).toBe('Team')
  })

  it('switches tabs and draws each section state', async () => {
    const { container } = await render({
      section: { kind: 'ready', value: game },
      retry: null
    })
    const click = async (label: string): Promise<void> => {
      const tab = [...container.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find(
        (node) => node.textContent === label
      )
      // Radix tabs activate on mousedown, as a pointer press does.
      await act(async () => {
        tab?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 }))
      })
    }

    await click('PRs')
    expect(selectedTab(container)).toBe('PRs')
    expect(panelText(container)).toContain('Could not read pull requests')
    expect(panelText(container)).toContain('rate limited')

    await click('Queue')
    expect(panelText(container)).toContain('The queue is empty')
  })

  it('falls back to the first tab when the stored one is hidden', async () => {
    useTeamPanelTabStore.setState({ selected: 'machines' })
    const { container } = await render({
      section: { kind: 'ready', value: game },
      retry: null
    })

    expect(selectedTab(container)).toBe('Team')
  })

  it('heads a session with no team as Your work and opens on Activity', async () => {
    const { container } = await render({
      section: { kind: 'ready', value: solo },
      retry: null
    })

    expect(container.querySelector('h2')?.textContent).toBe('Your work')
    expect(selectedTab(container)).toBe('Activity')
    expect(panelText(container)).toContain('No agents running')
  })

  it('counts the sessions above the tabs on every tab, hidden with a single session', async () => {
    const twoSessions: TeamPanelSoloModel = {
      ...solo,
      rows: [sessionRow('attention'), sessionRow('attention')],
      inbox: { kind: 'ready', value: { forYou: 2, waiting: 0, threads: 0, answered: 0 } }
    }
    const { container: view } = await render({
      section: { kind: 'ready', value: twoSessions },
      retry: null
    })
    const count = (): Element | null => view.querySelector('[data-team-activity-count]')
    expect(count()?.textContent).toBe('2 need you0 working0 done')
    expect(
      count()!.compareDocumentPosition(view.querySelector('[role="tablist"]')!) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy()
    await act(async () => useTeamPanelTabStore.getState().select('inbox'))
    expect(useTeamPanelTabStore.getState().shown).toBe('inbox')
    expect(count()).not.toBeNull()

    const { container: one } = await render({
      section: { kind: 'ready', value: { ...solo, rows: [sessionRow('working')] } },
      retry: null
    })
    expect(one.querySelector('[data-team-activity-count]')).toBeNull()
  })

  it('publishes the tab it really shows, so a hidden stored tab reads as Activity', async () => {
    useTeamPanelTabStore.setState({ selected: 'prs' })
    await render({ section: { kind: 'ready', value: solo }, retry: null })
    expect(useTeamPanelTabStore.getState().shown).toBe('activity')
  })

  it('shows a busy skeleton while the model loads', async () => {
    const { container } = await render({
      section: { kind: 'loading' },
      retry: null
    })

    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull()
    expect(container.querySelector('[role="tablist"]')).toBeNull()
  })

  it('offers a retry when the model fails to load', async () => {
    const retry = vi.fn()
    const { container } = await render({
      section: { kind: 'error', message: "Error invoking remote method 'runtime:call': boom" },
      retry
    })
    const button = [...container.querySelectorAll('button')].find(
      (node) => node.textContent === 'Try again'
    )

    expect(container.textContent).toContain('Could not read the team')
    expect(container.textContent).toContain('Orca is not responding in this project. Try again.')
    expect(container.textContent).not.toContain('runtime:call')
    await act(async () => button?.click())
    expect(retry).toHaveBeenCalledTimes(1)
  })

  it('keeps the team on screen with the error and a retry when a later read fails', async () => {
    const retry = vi.fn()
    const { container } = await render({ section: { kind: 'ready', value: game }, retry })
    const button = [...container.querySelectorAll('button')].find(
      (node) => node.textContent === 'Try again'
    )

    expect(container.querySelector('[role="tablist"]')).not.toBeNull()
    expect(container.textContent).toContain('Could not read the team')
    await act(async () => button?.click())
    expect(retry).toHaveBeenCalledTimes(1)
  })

  // Why inside the tab: at the panel's foot the floating board button covers the text.
  it('draws the read error where V28 does, under the lead and before the members', async () => {
    const { container } = await render({ section: { kind: 'ready', value: game }, retry: vi.fn() })
    const text = panelText(container)

    expect(text.indexOf('Lead')).toBeGreaterThanOrEqual(0)
    expect(text.indexOf('Lead')).toBeLessThan(text.indexOf('Could not read the team'))
    expect(text.indexOf('Could not read the team')).toBeLessThan(text.indexOf('No agents yet'))
  })

  it('keeps the read error on the other tabs, which came from the same read', async () => {
    useTeamPanelTabStore.setState({ selected: 'inbox' })
    const { container } = await render({ section: { kind: 'ready', value: game }, retry: vi.fn() })

    expect(selectedTab(container)).toBe('Inbox2')
    expect(panelText(container)).toContain('Could not read the team')
  })

  it('shows no read error while the team reads fine', async () => {
    const { container } = await render({ section: { kind: 'ready', value: game }, retry: null })

    expect(container.textContent).not.toContain('Could not read the team')
  })

  it('says so when this host cannot supply team data, with no invented rows', async () => {
    const { container } = await render({
      section: { kind: 'unavailable' },
      retry: null
    })

    expect(container.textContent).toContain('Team data is not available')
    expect(container.querySelector('[role="tablist"]')).toBeNull()
  })

  it('opens settings from the gear', async () => {
    const { container, onOpenSettings } = await render({
      section: { kind: 'ready', value: game },
      retry: null
    })
    const gear = container.querySelector<HTMLButtonElement>('button[aria-label="Project settings"]')

    await act(async () => gear?.click())
    expect(onOpenSettings).toHaveBeenCalledWith('repo-1')
  })
})

describe('TeamPanelView scene area', () => {
  const scene = (container: HTMLElement): Element | null =>
    container.querySelector('[data-team-scene] canvas')

  it('draws the live scene in the Game look', async () => {
    const { container } = await render(
      { section: { kind: 'ready', value: game }, retry: null },
      vi.fn(),
      'game'
    )

    expect(scene(container)).not.toBeNull()
  })

  it('draws the metrics carousel instead of the scene in the Display look, and only with a team', async () => {
    const carousel = (container: HTMLElement): Element | null =>
      container.querySelector('[aria-roledescription="carousel"]')
    const display = await render(
      { section: { kind: 'ready', value: game }, retry: null },
      vi.fn(),
      'display'
    )
    expect(carousel(display.container)).not.toBeNull()
    expect(scene(display.container)).toBeNull()

    const plain = await render({ section: { kind: 'ready', value: game }, retry: null })
    expect(carousel(plain.container)).toBeNull()

    const noTeam = await render(
      { section: { kind: 'ready', value: solo }, retry: null },
      vi.fn(),
      'display'
    )
    expect(carousel(noTeam.container)).toBeNull()
  })

  it('draws no scene in the Plain look or without a team', async () => {
    const plain = await render({ section: { kind: 'ready', value: game }, retry: null })
    expect(scene(plain.container)).toBeNull()

    const noTeam = await render(
      { section: { kind: 'ready', value: solo }, retry: null },
      vi.fn(),
      'game'
    )
    expect(scene(noTeam.container)).toBeNull()
  })
})

describe('teamPanelSettingsRepoId', () => {
  it('names the project with a team and no project without one', () => {
    expect(teamPanelSettingsRepoId(game)).toBe('repo-1')
    expect(teamPanelSettingsRepoId(solo)).toBeNull()
    expect(teamPanelSettingsRepoId(null)).toBeNull()
  })
})
