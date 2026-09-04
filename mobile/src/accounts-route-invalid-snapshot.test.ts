import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import AccountsScreen from '../app/h/[hostId]/accounts'

const dependencies = vi.hoisted(() => ({
  back: vi.fn(),
  loadHosts: vi.fn(),
  listResponse: vi.fn(),
  subscriptionListeners: [] as Array<(payload: unknown) => void>
}))

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: { getItem: vi.fn(), setItem: vi.fn(), removeItem: vi.fn() }
}))

vi.mock('react-native', () => ({
  ActivityIndicator: 'ActivityIndicator',
  Alert: { alert: vi.fn() },
  AppState: { currentState: 'active', addEventListener: () => ({ remove: () => {} }) },
  Pressable: 'Pressable',
  RefreshControl: 'RefreshControl',
  ScrollView: 'ScrollView',
  StyleSheet: { create: (styles: unknown) => styles, hairlineWidth: 1 },
  Text: 'Text',
  View: 'View'
}))

vi.mock('react-native-safe-area-context', () => ({
  SafeAreaView: 'SafeAreaView',
  useSafeAreaInsets: () => ({ bottom: 0, left: 0, right: 0, top: 0 })
}))

vi.mock('expo-router', async () => {
  const React = await import('react')
  return {
    useFocusEffect(effect: () => void | (() => void)): void {
      React.useEffect(effect, [effect])
    },
    useLocalSearchParams: () => ({ hostId: 'host-1' }),
    useRouter: () => ({ back: dependencies.back })
  }
})

vi.mock('expo-crypto', () => ({ randomUUID: vi.fn() }))

vi.mock('lucide-react-native', () => ({
  Check: 'Check',
  ChevronLeft: 'ChevronLeft',
  RefreshCw: 'RefreshCw',
  RotateCcw: 'RotateCcw',
  User: 'User'
}))

vi.mock('./transport/host-store', () => ({ loadHosts: dependencies.loadHosts }))

vi.mock('./transport/client-context', () => {
  const client = {
    sendRequest: async (method: string) => {
      if (method === 'status.get') {
        return { id: 'status', ok: true, result: { capabilities: [] }, _meta: { runtimeId: 'r' } }
      }
      if (method === 'accounts.list') {
        return dependencies.listResponse()
      }
      throw new Error(`Unexpected request: ${method}`)
    },
    subscribe: (_method: string, _params: unknown, onData: (payload: unknown) => void) => {
      dependencies.subscriptionListeners.push(onData)
      return vi.fn()
    }
  }
  return { useHostClient: () => ({ client, state: 'connected' }) }
})

vi.mock('./components/AgentIcons', () => ({
  ClaudeIcon: 'ClaudeIcon',
  OpenAIIcon: 'OpenAIIcon'
}))

// A shape this client rejects: rateLimits.codexTarget.runtime is not a known runtime.
// The field path is what tells you which side of the skew to fix (ORCA-348).
const INVALID_SNAPSHOT = {
  claude: { accounts: [], activeAccountId: null },
  codex: { accounts: [], activeAccountId: null, activeAccountIdsByRuntime: { host: null, wsl: {} } },
  rateLimits: {
    claude: null,
    codex: null,
    claudeTarget: { runtime: 'host', wslDistro: null },
    codexTarget: { runtime: 'kubernetes', wslDistro: null },
    inactiveClaudeAccounts: [],
    inactiveCodexAccounts: []
  }
} as const

const VALID_SNAPSHOT = {
  claude: { accounts: [], activeAccountId: null },
  codex: {
    accounts: [
      {
        id: 'codex-1',
        email: 'dev@example.com',
        managedHomeRuntime: 'host',
        wslDistro: null,
        updatedAt: 10
      }
    ],
    activeAccountId: 'codex-1',
    activeAccountIdsByRuntime: { host: 'codex-1', wsl: {} }
  },
  rateLimits: {
    ...INVALID_SNAPSHOT.rateLimits,
    codexTarget: { runtime: 'host', wslDistro: null }
  }
} as const

async function renderAccountsRoute(): Promise<ReactTestRenderer> {
  let renderer: ReactTestRenderer | null = null
  await act(async () => {
    renderer = create(createElement(AccountsScreen))
    await Promise.resolve()
  })
  if (!renderer) {
    throw new Error('Accounts route did not render')
  }
  return renderer
}

function shownText(renderer: ReactTestRenderer): string {
  return renderer.root
    .findAllByType('Text')
    .map((node) => node.children.filter((child) => typeof child === 'string').join(''))
    .join('\n')
}

/** RefreshControl is a ScrollView prop, so it is an element rather than a mounted node. */
async function pullToRefresh(renderer: ReactTestRenderer): Promise<void> {
  const scroll = renderer.root.findByType('ScrollView')
  const onRefresh = scroll.props.refreshControl.props.onRefresh
  await act(async () => {
    await onRefresh()
  })
}

async function pushSnapshot(payload: unknown): Promise<void> {
  await act(async () => {
    for (const listener of dependencies.subscriptionListeners) {
      listener(payload)
    }
    await Promise.resolve()
  })
}

describe('accounts route invalid snapshot', () => {
  beforeEach(() => {
    dependencies.subscriptionListeners.length = 0
    dependencies.loadHosts.mockReset().mockResolvedValue([
      {
        id: 'host-1',
        name: 'Desk',
        endpoint: 'ws://127.0.0.1:6768',
        deviceToken: 'token',
        publicKeyB64: 'public-key',
        lastConnected: 1
      }
    ])
    dependencies.listResponse
      .mockReset()
      .mockReturnValue({ id: 'list', ok: true, result: INVALID_SNAPSHOT })
  })

  it('names the rejected field when the snapshot arrives over the subscription', async () => {
    const renderer = await renderAccountsRoute()
    await pushSnapshot({ type: 'snapshot', snapshot: INVALID_SNAPSHOT })

    const text = shownText(renderer)
    expect(text).toContain('Invalid accounts snapshot from host')
    // The discriminating half: a fixed string passes the line above and fails here.
    expect(text).toContain('codexTarget.runtime')
  })

  it('names the rejected field on the ready event too', async () => {
    const renderer = await renderAccountsRoute()
    await pushSnapshot({ type: 'ready', snapshot: INVALID_SNAPSHOT })

    expect(shownText(renderer)).toContain('codexTarget.runtime')
  })

  it('names the rejected field on the one-shot refresh path', async () => {
    const renderer = await renderAccountsRoute()
    await pullToRefresh(renderer)

    expect(shownText(renderer)).toContain('codexTarget.runtime')
  })

  it('drops a proven snapshot when a later one is rejected', async () => {
    // Why this matters: a stale snapshot can offer a finite reset action for the
    // wrong account, so the reject path must clear it — the old equality check
    // never matched, so the screen kept showing the old accounts.
    const renderer = await renderAccountsRoute()
    await pushSnapshot({ type: 'ready', snapshot: VALID_SNAPSHOT })
    expect(shownText(renderer)).toContain('dev@example.com')

    await pullToRefresh(renderer)

    const text = shownText(renderer)
    expect(text).not.toContain('dev@example.com')
    expect(text).toContain('codexTarget.runtime')
  })

  it('shows a host RPC failure verbatim rather than the invalid-snapshot text', async () => {
    const renderer = await renderAccountsRoute()
    dependencies.listResponse.mockReturnValue({
      id: 'list',
      ok: false,
      error: { code: 'internal', message: 'accounts store is locked' },
      _meta: { runtimeId: 'r' }
    })
    await pullToRefresh(renderer)

    const text = shownText(renderer)
    expect(text).toContain('accounts store is locked')
    expect(text).not.toContain('Invalid accounts snapshot from host')
  })
})
