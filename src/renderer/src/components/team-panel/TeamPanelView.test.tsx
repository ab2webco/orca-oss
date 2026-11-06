// @vitest-environment happy-dom

import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type {
  TeamLeadCard,
  TeamPanelGameModel,
  TeamPanelSoloModel
} from '../../../../shared/team-panel-model-types'
import { TooltipProvider } from '@/components/ui/tooltip'
import { TeamPanelView, teamPanelSettingsTarget } from './TeamPanelView'
import { useTeamPanelTabStore } from './team-panel-tab-store'
import type { TeamPanelModelSource } from './use-team-panel-model'
import type { TeamPanelLook } from './use-team-panel-look'

vi.mock('@/i18n/i18n', () => ({
  translate: (_key: string, fallback: string) => fallback
}))

const roots: ReturnType<typeof createRoot>[] = []

afterEach(async () => {
  await act(async () => {
    for (const root of roots.splice(0)) {
      root.unmount()
    }
  })
  document.body.innerHTML = ''
  useTeamPanelTabStore.setState({ selected: null })
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
  branch: null
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
  scene: { id: null, extensions: [] },
  inbox: {
    kind: 'ready',
    value: { forYou: 2, waiting: 0, threads: 0, answered: 0 }
  },
  prs: { kind: 'error', message: 'rate limited' },
  queue: { kind: 'ready', value: [] },
  machines: null
}

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
      section: { kind: 'error', message: 'boom' },
      retry
    })
    const button = [...container.querySelectorAll('button')].find(
      (node) => node.textContent === 'Try again'
    )

    expect(container.textContent).toContain('boom')
    await act(async () => button?.click())
    expect(retry).toHaveBeenCalledTimes(1)
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
    expect(onOpenSettings).toHaveBeenCalledWith({
      pane: 'repo',
      repoId: 'repo-1'
    })
  })
})

describe('TeamPanelView scene area', () => {
  const placeholder = (container: HTMLElement): Element | null =>
    container.querySelector('[data-team-scene-placeholder]')

  it('holds the scene place in the Game look with no figure drawn', async () => {
    const { container } = await render(
      { section: { kind: 'ready', value: game }, retry: null },
      vi.fn(),
      'game'
    )

    expect(placeholder(container)).not.toBeNull()
    expect(container.querySelector('canvas, img')).toBeNull()
  })

  it('draws no scene in the Plain look or without a team', async () => {
    const plain = await render({ section: { kind: 'ready', value: game }, retry: null })
    expect(placeholder(plain.container)).toBeNull()

    const noTeam = await render(
      { section: { kind: 'ready', value: solo }, retry: null },
      vi.fn(),
      'game'
    )
    expect(placeholder(noTeam.container)).toBeNull()
  })
})

describe('teamPanelSettingsTarget', () => {
  it('opens the project with a team and the global Agents settings without one', () => {
    expect(teamPanelSettingsTarget(game)).toEqual({
      pane: 'repo',
      repoId: 'repo-1'
    })
    expect(teamPanelSettingsTarget(solo)).toEqual({
      pane: 'agents',
      repoId: null
    })
    expect(teamPanelSettingsTarget(null)).toEqual({
      pane: 'agents',
      repoId: null
    })
  })
})
