// @vitest-environment happy-dom

import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { TeamMemberCard, TeamPanelGameModel } from '../../../../shared/team-panel-model-types'
import { useGameInboxAppState } from '@/components/game-inbox/game-inbox-app-state'
import type { TeamPanelModelSource } from './use-team-panel-model'
import { signalGameOwnerQuestionsChanged } from '@/components/game-inbox/game-owner-questions-signal'
import { signalGameAdvisorChanged } from './game-advisor-signal'

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
  terminalLayoutsByTabId: {},
  agentStatusByPaneKey: {}
})
let appState = baseState()
vi.mock('@/store', () => ({
  useAppStore: Object.assign(
    (selector: (state: Record<string, unknown>) => unknown) => selector(appState),
    { getState: () => ({}) }
  )
}))

const LEAD = { paneKey: 'tab-lead:leaf-lead', host: { kind: 'local' }, name: 'Run home' }

const solo = {
  kind: 'solo',
  inbox: { kind: 'ready', value: { forYou: 1, waiting: 0, threads: 0, answered: 0 } }
}
vi.mock('./use-team-panel-solo-model', () => ({
  useTeamPanelSoloModel: (active: boolean) => (active ? solo : null)
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

  // Why: a failed read says nothing about the team, so it must never read as the user's own sessions.
  it('keeps a failed read on the team view instead of the no-team view', async () => {
    const seen: { section: unknown; kind: unknown } = { section: null, kind: undefined }
    await mount(() => {
      seen.section = useTeamPanelModel().section
      seen.kind = useTeamPanelKind()
      return null
    })

    const section: TeamPanelModelSource['section'] = { kind: 'error', message: 'timeout' }
    await act(async () => publish({ section, retry: () => {} }))

    expect(seen.section).toEqual(section)
    expect(seen.kind).toBeNull()
  })

  it('shows the no-team view when the host has no team to read', async () => {
    const seen: { section: unknown; kind: unknown } = { section: null, kind: undefined }
    await mount(() => {
      seen.section = useTeamPanelModel().section
      seen.kind = useTeamPanelKind()
      return null
    })

    await act(async () => publish({ section: { kind: 'unavailable' }, retry: null }))

    expect(seen.section).toEqual({ kind: 'ready', value: solo })
    expect(seen.kind).toBe('solo')
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
        value: {
          kind: 'team',
          lead: LEAD,
          members: [remote, local]
        } as unknown as TeamPanelGameModel
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
    section: {
      kind: 'ready',
      value: { kind: 'team', lead: LEAD, members } as unknown as TeamPanelGameModel
    },
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
      lead: LEAD,
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

describe("Team model Inbox count with the lead's own question (ORCA-1129 D4)", () => {
  // Why: game.state carries no AskUserQuestion, so Para ti read 0 while the lead waited on you.
  it("counts the lead's live AskUserQuestion in For you", async () => {
    appState = {
      ...baseState(),
      agentStatusByPaneKey: {
        'tab-lead:leaf-lead': {
          state: 'waiting',
          paneKey: 'tab-lead:leaf-lead',
          toolName: 'AskUserQuestion',
          interactivePrompt: JSON.stringify({
            questions: [{ question: 'Merge #923 now?', options: [{ label: 'Now' }] }]
          })
        }
      }
    }
    let seen: TeamPanelModelSource | null = null
    await mount(() => {
      seen = useTeamPanelModel()
      return null
    })
    const model = {
      kind: 'team',
      projectName: 'orca-oss',
      lead: { paneKey: 'tab-lead:leaf-lead', host: { kind: 'local' }, name: 'Run home' },
      inbox: { kind: 'ready', value: { forYou: 0, waiting: 0, threads: 0, answered: 0 } }
    } as unknown as TeamPanelGameModel
    await act(async () => publish({ section: { kind: 'ready', value: model }, retry: null }))

    const section = (seen as TeamPanelModelSource | null)?.section
    expect(section?.kind === 'ready' ? section.value.inbox : null).toEqual({
      kind: 'ready',
      value: { forYou: 1, waiting: 0, threads: 0, answered: 0 }
    })
  })
})

describe('Team model Inbox count with no team', () => {
  // Why: the no-team model reads agent status alone, and the Sheet counted the project's questions.
  it("adds this project's own open questions to the agents that ask", async () => {
    appState = { ...baseState(), activeWorktreeId: 'repo-1::/wt' }
    useGameInboxAppState.setState({
      hosts: [
        {
          environmentId: null,
          status: 'ok',
          projects: [
            {
              repoId: 'repo-1',
              repoName: 'orca-oss',
              worktreeId: 'repo-1::/wt',
              questions: [
                {
                  id: 'q-own',
                  ticket: 'ORCA-940',
                  question: 'Ship the arcade in lab.111?',
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
    await act(async () => publish({ section: { kind: 'unavailable' }, retry: null }))

    const section = (seen as TeamPanelModelSource | null)?.section
    expect(section?.kind === 'ready' ? section.value.inbox : null).toEqual({
      kind: 'ready',
      value: { forYou: 2, waiting: 0, threads: 0, answered: 0 }
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

  // Why: the scene's advisor bubble fades in 6 s; a 20 s read showed a new Jev line late (ORCA-1120).
  it('re-reads when a Jev report changes on this computer or a paired host', async () => {
    let pushed: (() => void) | null = null
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: {
        runtime: {
          onGameAdvisorChanged: (callback: () => void) => {
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
    act(() => signalGameAdvisorChanged())
    expect(refresh).toHaveBeenCalledTimes(2)

    await act(async () => roots.splice(0).forEach((root) => root.unmount()))
    act(() => signalGameAdvisorChanged())
    expect(pushed).toBeNull()
    expect(refresh).toHaveBeenCalledTimes(2)
  })
})
