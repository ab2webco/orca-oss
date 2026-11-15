import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { RpcClient, RpcResponse } from '../transport/rpc-client'
import type { TeamDrawerData } from './team-drawer-model'

vi.mock('react-native', () => ({ AppState: { currentState: 'active' } }))
vi.mock('expo-router', async () => {
  const React = await import('react')
  return {
    useFocusEffect(effect: () => void | (() => void)): void {
      React.useEffect(effect, [effect])
    }
  }
})

const { useTeamDrawer } = await import('./use-team-drawer')

const question = {
  id: 'q1',
  ticket: 'orca-7',
  question: 'Ship it?',
  options: ['Yes'],
  context: null,
  askedAt: '2026-11-02T10:00:00.000Z',
  answer: null
}
const waiting = {
  id: 'msg_1',
  ticket: 'ORCA-7',
  kind: 'question',
  subject: 'Port',
  body: 'Which port?',
  at: '2026-11-02T10:00:00.000Z',
  answerer: 'lead'
}
const leadState = {
  role: 'lead',
  lead: { autostart: false, cap: 4, agent: 'claude' },
  agents: [
    {
      paneKey: 'm1',
      displayName: 'ORCA-7',
      agentType: 'claude',
      state: 'working',
      toolName: null,
      isLeader: false,
      isMember: true
    }
  ]
}

const ok = (result: unknown): RpcResponse =>
  ({ id: 'x', ok: true, result, _meta: { runtimeId: 'rt' } }) as RpcResponse

function hostReplying(state: unknown) {
  return vi.fn(async (method: string) => {
    if (method === 'game.state') {
      return ok(state)
    }
    if (method === 'game.characters') {
      return ok({ characters: [{ xp: 240 }, { xp: 100 }] })
    }
    if (method === 'game.inboxThreads') {
      return ok({ threads: [], waiting: [waiting], answered: [] })
    }
    if (method === 'game.ownerQuestionsAll') {
      return ok({
        projects: [
          { repoId: 'repo', repoName: 'r', worktreeId: 'repo::/main', questions: [question] }
        ]
      })
    }
    return ok({ answered: true })
  })
}

const renderers: ReactTestRenderer[] = []
let team: TeamDrawerData | null = null

type ProbeProps = {
  client: RpcClient
  terminalHandle: string | null
  paneKey: string | null
  levelSupported?: boolean
  sceneArtSupported?: boolean
}
function Probe({ levelSupported = false, sceneArtSupported = false, ...props }: ProbeProps) {
  team = useTeamDrawer({
    ...props,
    levelSupported,
    sceneArtSupported,
    connected: true,
    worktreeId: 'repo::/lead'
  })
  return null
}

async function render(props: ProbeProps) {
  await act(async () => {
    renderers[renderers.length] = create(createElement(Probe, props))
  })
}

afterEach(() => {
  act(() => {
    for (const renderer of renderers.splice(0)) {
      renderer.unmount()
    }
  })
  team = null
})

describe('useTeamDrawer', () => {
  it("reads the lead's state with its pane and its open question", async () => {
    const sendRequest = hostReplying(leadState)
    const client = { sendRequest } as unknown as RpcClient
    await render({ client, terminalHandle: 'term_1', paneKey: 'tab:leaf' })

    expect(sendRequest).toHaveBeenCalledWith('game.state', {
      worktreeId: 'repo::/lead',
      terminalHandle: 'term_1',
      paneKey: 'tab:leaf'
    })
    expect(team?.questions).toHaveLength(1)
    expect(team?.view?.members[0]).toMatchObject({ ticket: 'ORCA-7', needsYou: true })
  })

  it("reads the lead's Inbox threads with its terminal once it is the lead", async () => {
    const sendRequest = hostReplying(leadState)
    const client = { sendRequest } as unknown as RpcClient
    await render({ client, terminalHandle: 'term_1', paneKey: 'tab:leaf' })

    expect(sendRequest).toHaveBeenCalledWith('game.inboxThreads', {
      worktreeId: 'repo::/lead',
      terminalHandle: 'term_1'
    })
    expect(team?.inbox).toEqual({
      kind: 'ready',
      threads: { threads: [], waiting: [waiting], answered: [] }
    })
  })

  it('reads nothing for a tab with no pane key, and shows no Team', async () => {
    const sendRequest = hostReplying(leadState)
    const client = { sendRequest } as unknown as RpcClient
    await render({ client, terminalHandle: 'term_1', paneKey: null })

    expect(sendRequest).not.toHaveBeenCalledWith('game.state', expect.anything())
    expect(team?.view).toBeNull()
    expect(team?.questions).toEqual([])
  })

  it('shows no Team for a pane that is not the lead', async () => {
    const client = { sendRequest: hostReplying({ ...leadState, role: 'member' }) }
    await render({ client: client as unknown as RpcClient, terminalHandle: 't', paneKey: 'p' })
    expect(team?.view).toBeNull()
    expect(team?.questions).toEqual([])
    expect(client.sendRequest).not.toHaveBeenCalledWith('game.inboxThreads', expect.anything())
  })

  it("reads the team's level from the characters' XP on a host that advertises it", async () => {
    const sendRequest = hostReplying(leadState)
    const client = { sendRequest } as unknown as RpcClient
    await render({ client, terminalHandle: 'term_1', paneKey: 'tab:leaf', levelSupported: true })

    expect(sendRequest).toHaveBeenCalledWith('game.characters', {
      worktreeId: 'repo::/lead',
      terminalHandle: 'term_1'
    })
    expect(team?.level).toEqual({ level: 3, into: 40, need: 300 })
  })

  it('never asks an older host for XP, and shows no level', async () => {
    const sendRequest = hostReplying(leadState)
    const client = { sendRequest } as unknown as RpcClient
    await render({ client, terminalHandle: 'term_1', paneKey: 'tab:leaf' })

    expect(sendRequest).not.toHaveBeenCalledWith('game.characters', expect.anything())
    expect(team?.level).toBeNull()
  })

  const role = (sheets: string[]) => ({
    sheets,
    frame: { width: 64, height: 64 },
    size: 50,
    animations: { idle: { row: 0, frames: 1 } }
  })
  const marioState = {
    ...leadState,
    agents: [
      { ...leadState.agents[0], paneKey: 'lead', isLeader: true, isMember: false },
      ...leadState.agents
    ],
    panel: { look: 'game', style: 'figures', tabs: {}, advisor: true, arcade: true },
    config: { scene: 'mario' },
    extensions: {
      scenes: [
        {
          id: 'mario',
          pluginId: 'project',
          definition: {
            native: {
              figures: {
                layers: [{ src: 'sky.png' }, { src: 'bush.png', front: true }],
                roles: { lead: role(['mario.png']), member: role(['toad.png']) }
              }
            }
          }
        }
      ]
    }
  }
  const png = btoa(
    String.fromCharCode(
      137,
      80,
      78,
      71,
      13,
      10,
      26,
      10,
      0,
      0,
      0,
      13,
      73,
      72,
      68,
      82,
      0,
      0,
      0,
      64,
      0,
      0,
      0,
      64
    )
  )
  const serving = (fail: string | null) => {
    const base = hostReplying(marioState)
    return vi.fn(async (method: string, params?: unknown) => {
      if (method !== 'game.sceneArt') {
        return base(method)
      }
      const src = (params as { src: string }).src
      return src === fail
        ? ({
            id: 'x',
            ok: false,
            error: { code: 'internal', message: 'gone' },
            _meta: { runtimeId: 'rt' }
          } as RpcResponse)
        : ok({ contentBase64: png, mimeType: 'image/png' })
    })
  }

  it("reads only the images the scene band draws, on a host that serves the scene's art", async () => {
    const sendRequest = serving(null)
    const client = { sendRequest } as unknown as RpcClient
    await render({ client, terminalHandle: 'term_1', paneKey: 'lead', sceneArtSupported: true })

    const asked = sendRequest.mock.calls
      .filter(([method]) => method === 'game.sceneArt')
      .map(([, params]) => (params as { src: string }).src)
      .toSorted()
    expect(asked).toEqual(['bush.png', 'mario.png', 'sky.png', 'toad.png'])
    expect(sendRequest).toHaveBeenCalledWith('game.sceneArt', {
      worktreeId: 'repo::/lead',
      terminalHandle: 'term_1',
      sceneId: 'mario',
      src: 'sky.png'
    })
    expect(team?.sceneArt?.kind).toBe('ready')
  })

  it("draws the fallback when any of the scene's images fails, as the desktop draws Pixel", async () => {
    const client = { sendRequest: serving('toad.png') } as unknown as RpcClient
    await render({ client, terminalHandle: 'term_1', paneKey: 'lead', sceneArtSupported: true })
    expect(team?.sceneArt).toEqual({ kind: 'failed' })
  })

  it("never asks an older host for the scene's art", async () => {
    const sendRequest = serving(null)
    const client = { sendRequest } as unknown as RpcClient
    await render({ client, terminalHandle: 'term_1', paneKey: 'lead' })
    expect(sendRequest).not.toHaveBeenCalledWith('game.sceneArt', expect.anything())
    expect(team?.sceneArt).toBeNull()
  })

  it('answers once through the board, on the worktree the Inbox answers through', async () => {
    const sendRequest = hostReplying(leadState)
    const client = { sendRequest } as unknown as RpcClient
    await render({ client, terminalHandle: 'term_1', paneKey: 'tab:leaf' })

    await act(async () => team?.answer('q1', { option: 1 }))
    const answers = sendRequest.mock.calls.filter(([method]) => method === 'game.ownerAnswer')
    expect(answers).toEqual([
      ['game.ownerAnswer', { worktreeId: 'repo::/main', id: 'q1', option: 1 }]
    ])
  })
})
