// @vitest-environment happy-dom

import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { TeamMemberCard, TeamPanelGameModel } from '../../../../shared/team-panel-model-types'
import { useGameInboxAppState } from '@/components/game-inbox/game-inbox-app-state'
import type { TeamPanelModelSource } from './use-team-panel-model'
import { signalGameOwnerQuestionsChanged } from '@/components/game-inbox/game-owner-questions-signal'

const subscribe = vi.fn(() => () => {})
const refresh = vi.fn()
let publish: (source: TeamPanelModelSource, scope?: unknown) => void = () => {}
vi.mock('./team-panel-model-poll', () => ({
  createTeamPanelModelPoller: (deps: { publish: typeof publish }) => {
    publish = deps.publish
    return { subscribe, refresh }
  }
}))
const baseState = (): Record<string, unknown> => ({
  activeWorkspaceExecutionHostId: null,
  activeWorktreeId: 'wt',
  getKnownWorktreeById: () => ({ repoId: 'repo-1' }),
  repos: [{ id: 'repo-1', displayName: 'orca-oss' }],
  worktreesByRepo: { 'repo-1': [{ id: 'wt' }] },
  runtimeEnvironments: [],
  rightSidebarOpen: true,
  rightSidebarTab: 'team',
  tabsByWorktree: {},
  ptyIdsByTabId: {},
  terminalLayoutsByTabId: {}
})
let appState = baseState()
vi.mock('@/store', () => ({
  useAppStore: Object.assign(
    (selector: (state: Record<string, unknown>) => unknown) => selector(appState),
    { getState: () => ({}) }
  )
}))

const { toRemoteRuntimePtyId } = await import('@/runtime/runtime-terminal-stream')
const { useTeamMemberOfTab, useTeamPanelKind, useTeamPanelModel } =
  await import('./use-team-panel-model')

const roots: ReturnType<typeof createRoot>[] = []
beforeEach(() => {
  Object.defineProperty(window, 'api', { configurable: true, value: { runtime: {} } })
})
afterEach(async () => {
  await act(async () => {
    for (const root of roots.splice(0)) {
      root.unmount()
    }
  })
  subscribe.mockClear()
  refresh.mockClear()
  appState = baseState()
  useGameInboxAppState.setState({ hosts: [] })
  // Why: the model store is module state; a test's partial model must not reach the next test.
  publish({ section: { kind: 'loading' }, retry: null })
  Reflect.deleteProperty(window, 'api')
})

async function mount(Probe: () => null): Promise<void> {
  const root = createRoot(document.createElement('div'))
  roots.push(root)
  await act(async () => root.render(<Probe />))
}

describe('Team model polling', () => {
  it('polls only for the open panel', async () => {
    await mount(() => {
      useTeamPanelModel()
      return null
    })

    expect(subscribe).toHaveBeenCalledTimes(1)
  })

  // Why: the activity bar is always mounted; polling game.state for it would run with the panel closed.
  it('reads the last kind for the activity bar without polling', async () => {
    await mount(() => {
      useTeamPanelKind()
      return null
    })

    expect(subscribe).not.toHaveBeenCalled()
  })
})

const LEAF = '7f3c1e2a-4b5d-4c6e-8f90-a1b2c3d4e5f6'
const card = (name: string, host: TeamMemberCard['host']): TeamMemberCard =>
  ({ name, paneKey: `tab-7:${LEAF}`, host }) as TeamMemberCard

describe('useTeamMemberOfTab', () => {
  it("finds the local member whose pane is in the tab, never a paired host's same tab id", async () => {
    const remote = card('Squire', {
      kind: 'remote',
      name: 'mini',
      environmentId: 'e',
      reachable: true
    })
    const local = card('Knight', { kind: 'local' })
    publish({
      section: {
        kind: 'ready',
        value: { kind: 'team', members: [remote, local] } as unknown as TeamPanelGameModel
      },
      retry: null
    })
    const seen: (string | null)[] = []

    await mount(() => {
      seen.push(
        useTeamMemberOfTab('tab-7')?.name ?? null,
        useTeamMemberOfTab('tab-8')?.name ?? null
      )
      return null
    })

    expect(seen.slice(-2)).toEqual(['Knight', null])
    expect(subscribe).not.toHaveBeenCalled()
  })
})

describe('a paired host member', () => {
  const squire = {
    name: 'Squire',
    paneKey: `host-tab:${LEAF}`,
    terminalHandle: 'term_squire',
    worktreeId: 'host-wt',
    host: { kind: 'remote', name: 'mini', environmentId: 'env-mini', reachable: true }
  } as TeamMemberCard
  const teamOf = (members: TeamMemberCard[]): TeamPanelModelSource => ({
    section: { kind: 'ready', value: { kind: 'team', members } as unknown as TeamPanelGameModel },
    retry: null
  })

  it('heads the tab that mirrors its terminal, under another tab id than the host gave', async () => {
    appState = {
      ...baseState(),
      tabsByWorktree: { 'host-wt': [{ id: 'local-tab' }] },
      terminalLayoutsByTabId: {
        'local-tab': { ptyIdsByLeafId: { leaf: toRemoteRuntimePtyId('term_squire', 'env-mini') } }
      }
    }
    publish(teamOf([squire]))
    const seen: (string | null)[] = []

    await mount(() => {
      seen.push(useTeamMemberOfTab('local-tab')?.name ?? null)
      return null
    })

    expect(seen.at(-1)).toBe('Squire')
  })

  // Why: opening it activates the host's worktree, which is another project to the panel.
  it("keeps reading the lead's team while the member's worktree on its host is active", async () => {
    await mount(() => {
      useTeamPanelModel()
      return null
    })
    const leadScope = (subscribe.mock.calls.at(-1) as unknown as [{ key: string }])[0]
    publish(teamOf([squire]), leadScope)
    appState = {
      ...baseState(),
      activeWorktreeId: 'host-wt',
      activeWorkspaceExecutionHostId: 'runtime:env-mini',
      getKnownWorktreeById: () => ({ repoId: 'host-repo' }),
      repos: [{ id: 'host-repo', displayName: 'orca-oss' }]
    }

    await mount(() => {
      useTeamPanelModel()
      return null
    })

    const scopes = subscribe.mock.calls.map((call) => (call as unknown as [{ key: string }])[0].key)
    expect(scopes.at(-1)).toBe(leadScope.key)
  })
})

describe('Team model Inbox count', () => {
  // Why: only the Inbox tab has a count, and it must cover every project and host.
  it('adds other projects open questions to the Inbox For you count', async () => {
    useGameInboxAppState.setState({
      hosts: [
        {
          environmentId: 'env-imac',
          status: 'ok',
          projects: [
            {
              repoId: 'repo-web',
              repoName: 'Ab2Web',
              worktreeId: 'wt-web',
              questions: [
                {
                  id: 'q-web',
                  ticket: 'WEB-212',
                  question: 'Ship the price change today?',
                  options: [],
                  context: null,
                  askedAt: '2026-11-06T10:00:00.000Z',
                  answer: null
                }
              ]
            }
          ]
        }
      ]
    })
    let seen: TeamPanelModelSource | null = null
    await mount(() => {
      seen = useTeamPanelModel()
      return null
    })
    const model = {
      kind: 'team',
      inbox: { kind: 'ready', value: { forYou: 1, waiting: 0, threads: 2, answered: 0 } }
    } as unknown as TeamPanelGameModel
    await act(async () => publish({ section: { kind: 'ready', value: model }, retry: null }))

    const section = (seen as TeamPanelModelSource | null)?.section
    expect(section?.kind === 'ready' ? section.value.inbox : null).toEqual({
      kind: 'ready',
      value: { forYou: 2, waiting: 0, threads: 2, answered: 0 }
    })
  })
})

describe('Team model refresh', () => {
  // Why: an answer changes the Inbox count now; the 20 s poll alone left the badge stale.
  it('re-reads when an owner question changes on this computer or a paired host', async () => {
    let pushed: (() => void) | null = null
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: {
        runtime: {
          onGameOwnerQuestionsChanged: (callback: () => void) => {
            pushed = callback
            return () => {
              pushed = null
            }
          }
        }
      }
    })
    await mount(() => {
      useTeamPanelModel()
      return null
    })

    ;(pushed as (() => void) | null)?.()
    act(() => signalGameOwnerQuestionsChanged())

    expect(refresh).toHaveBeenCalledTimes(2)
  })
})
