import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { MobileSessionTab } from '../session/mobile-session-route-types'
import type { RpcClient } from '../transport/rpc-client'
import type { RpcResponse } from '../transport/types'
import { useFreshLead } from './use-fresh-lead'

vi.mock('../platform/haptics', () => ({ triggerError: vi.fn(), triggerSuccess: vi.fn() }))
vi.mock('lucide-react-native', () => ({ Crown: 'Crown', User: 'User', X: 'X' }))
vi.mock('react-native', () => ({ AppState: { addEventListener: vi.fn() } }))

const ok = (result: unknown): RpcResponse =>
  ({ id: 'x', ok: true, result, _meta: { runtimeId: 'rt' } }) as RpcResponse
const refused = (message: string): RpcResponse =>
  ({
    id: 'x',
    ok: false,
    error: { code: 'internal', message },
    _meta: { runtimeId: 'rt' }
  }) as RpcResponse
const snapshot = {
  claude: { accounts: [{ id: 'a-1', email: 'maya@acme.dev' }], activeAccountId: 'a-1' },
  codex: { accounts: [], activeAccountId: null },
  rateLimits: { claude: null, codex: null, inactiveClaudeAccounts: [], inactiveCodexAccounts: [] }
}
const NEW_TAB = {
  id: 'tab-new',
  type: 'terminal',
  terminal: 'term_new',
  title: 'Lead'
} as unknown as MobileSessionTab

type Hook = ReturnType<typeof useFreshLead>

describe('useFreshLead', () => {
  const mounted: { renderer?: ReactTestRenderer } = {}
  afterEach(() => {
    act(() => mounted.renderer?.unmount())
    mounted.renderer = undefined
  })

  async function setup(createAnswer: RpcResponse) {
    const sendRequest = vi.fn(async (method: string) =>
      method === 'accounts.list' ? ok(snapshot) : createAnswer
    )
    const client = { sendRequest } as unknown as RpcClient
    const showToast = vi.fn()
    const selectTab = vi.fn()
    const seen: Hook[] = []
    function Probe({ sessionTabs }: { sessionTabs: MobileSessionTab[] }) {
      seen.push(
        useFreshLead({
          client,
          hostName: 'm1',
          worktreeId: 'repo-a::/w/main',
          showToast,
          sessionTabs,
          selectTab
        })
      )
      return null
    }
    await act(async () => {
      mounted.renderer = create(createElement(Probe, { sessionTabs: [] }))
    })
    const rerender = async (sessionTabs: MobileSessionTab[]) =>
      act(async () => mounted.renderer!.update(createElement(Probe, { sessionTabs })))
    return { sendRequest, showToast, selectTab, rerender, hook: () => seen.at(-1)! }
  }

  // Why closeBeforePress: the sheet closes, then runs the row once it has unmounted.
  async function press(sheet: 'account' | 'confirm', hook: () => Hook, label: string) {
    const action = hook()[sheet].actions.find((one) => one.label === label)!
    await act(async () => hook()[sheet].onClose())
    await act(async () => action.onPress())
  }

  it("opens the account step on the lead desktop's accounts", async () => {
    const { hook } = await setup(ok({}))

    await act(async () => hook().start())

    expect(hook().account.visible).toBe(true)
    expect(hook().account.actions.map((a) => a.label)).toEqual(['maya@acme.dev', 'System default'])
    expect(hook().confirm.visible).toBe(false)
  })

  it('confirms the pick, starts the lead on it and shows its tab when it arrives', async () => {
    const created = ok({
      terminal: { handle: 'term_new', tabId: 'tab-new', worktreeId: 'repo-a::/w/main' },
      disposition: 'created'
    })
    const { hook, sendRequest, selectTab, rerender } = await setup(created)
    await act(async () => hook().start())

    await press('account', hook, 'maya@acme.dev')
    expect(hook().account.visible).toBe(false)
    expect(hook().confirm).toMatchObject({ visible: true, title: 'Start a fresh lead?' })
    expect(hook().confirm.actions[0].hint).toBe('Lead on maya@acme.dev · m1')

    await press('confirm', hook, 'Start')
    expect(sendRequest).toHaveBeenCalledWith(
      'terminal.createAgentSession',
      expect.objectContaining({
        agent: 'claude-agent-teams',
        prompt: '/orca-game:lead fresh',
        claudeAccountId: 'a-1'
      }),
      expect.anything()
    )
    expect(selectTab).not.toHaveBeenCalled()

    await rerender([NEW_TAB])
    expect(selectTab).toHaveBeenCalledWith(NEW_TAB)
  })

  it('does nothing on Cancel', async () => {
    const { hook, sendRequest } = await setup(ok({}))
    await act(async () => hook().start())
    await press('account', hook, 'System default')

    await press('confirm', hook, 'Cancel')

    expect(hook().confirm.visible).toBe(false)
    expect(sendRequest).not.toHaveBeenCalledWith(
      'terminal.createAgentSession',
      expect.anything(),
      expect.anything()
    )
  })

  it('says why the lead could not start', async () => {
    const { hook, showToast } = await setup(refused('Selected agent is disabled.'))
    await act(async () => hook().start())
    await press('account', hook, 'System default')

    await press('confirm', hook, 'Start')

    expect(showToast).toHaveBeenCalledWith(
      'Could not start the lead: Selected agent is disabled.',
      2400
    )
  })
})
