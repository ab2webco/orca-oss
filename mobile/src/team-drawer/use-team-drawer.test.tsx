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

type ProbeProps = { client: RpcClient; terminalHandle: string | null; paneKey: string | null }
function Probe(props: ProbeProps) {
  team = useTeamDrawer({ ...props, connected: true, worktreeId: 'repo::/lead' })
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
