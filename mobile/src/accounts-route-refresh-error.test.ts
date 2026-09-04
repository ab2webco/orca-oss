import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import AccountsScreen from '../app/h/[hostId]/accounts'

const dependencies = vi.hoisted(() => ({
  alert: vi.fn(),
  back: vi.fn(),
  listRequest: vi.fn(),
  loadHosts: vi.fn(),
  subscriptionListeners: [] as Array<(payload: unknown) => void>,
  asyncStorage: {
    getItem: vi.fn(),
    setItem: vi.fn(),
    removeItem: vi.fn()
  }
}))

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: dependencies.asyncStorage
}))

vi.mock('react-native', () => ({
  ActivityIndicator: 'ActivityIndicator',
  Alert: { alert: dependencies.alert },
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

vi.mock('expo-crypto', () => ({ randomUUID: () => '11111111-1111-4111-8111-111111111111' }))

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
        return {
          id: 'status',
          ok: true,
          result: { capabilities: [] },
          _meta: { runtimeId: 'runtime-1' }
        }
      }
      if (method === 'accounts.list') {
        return dependencies.listRequest()
      }
      throw new Error(`Unexpected request: ${method}`)
    },
    subscribe: (_method: string, _params: unknown, onData: (payload: unknown) => void) => {
      dependencies.subscriptionListeners.push(onData)
      onData({ type: 'ready', snapshot: SNAPSHOT })
      return vi.fn()
    }
  }
  return {
    useHostClient: () => ({ client, state: 'connected' })
  }
})

vi.mock('./components/AgentIcons', () => ({
  ClaudeIcon: 'ClaudeIcon',
  OpenAIIcon: 'OpenAIIcon'
}))

const SNAPSHOT = {
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
    claude: null,
    codex: null,
    claudeTarget: { runtime: 'host', wslDistro: null },
    codexTarget: { runtime: 'host', wslDistro: null },
    inactiveClaudeAccounts: [],
    inactiveCodexAccounts: []
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

function renderedTexts(renderer: ReactTestRenderer): string[] {
  return renderer.root.findAllByType('Text').map((node) => node.children.join(''))
}

async function pullToRefresh(renderer: ReactTestRenderer): Promise<void> {
  const refreshControl = renderer.root.findByType('ScrollView').props.refreshControl
  await act(async () => {
    await refreshControl.props.onRefresh()
  })
}

describe('accounts route refresh failure', () => {
  beforeEach(() => {
    dependencies.alert.mockReset()
    dependencies.listRequest.mockReset()
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
    dependencies.subscriptionListeners.length = 0
    dependencies.asyncStorage.getItem.mockReset().mockResolvedValue(null)
    dependencies.asyncStorage.setItem.mockReset().mockResolvedValue(undefined)
    dependencies.asyncStorage.removeItem.mockReset().mockResolvedValue(undefined)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('shows a refresh banner over the existing snapshot when the host refuses', async () => {
    dependencies.listRequest.mockResolvedValue({
      id: 'list',
      ok: false,
      error: { code: 'internal', message: 'boom' },
      _meta: { runtimeId: 'runtime-1' }
    })
    const renderer = await renderAccountsRoute()
    expect(renderedTexts(renderer)).toContain('dev@example.com')

    await pullToRefresh(renderer)

    const texts = renderedTexts(renderer)
    expect(texts).toContain('Could not refresh accounts — boom')
    expect(texts).toContain('dev@example.com')
    expect(texts.filter((text) => text === 'System default')).toHaveLength(2)
    act(() => renderer.unmount())
  })

  it('shows a refresh banner over the existing snapshot when the request throws', async () => {
    dependencies.listRequest.mockRejectedValue(new Error('Connection lost'))
    const renderer = await renderAccountsRoute()

    await pullToRefresh(renderer)

    const texts = renderedTexts(renderer)
    expect(texts).toContain('Could not refresh accounts — Connection lost')
    expect(texts).toContain('dev@example.com')
    act(() => renderer.unmount())
  })

  it('clears the refresh banner once a snapshot arrives', async () => {
    dependencies.listRequest.mockRejectedValue(new Error('Connection lost'))
    const renderer = await renderAccountsRoute()
    await pullToRefresh(renderer)
    expect(renderedTexts(renderer)).toContain('Could not refresh accounts — Connection lost')

    act(() => {
      dependencies.subscriptionListeners[0]?.({ type: 'snapshot', snapshot: SNAPSHOT })
    })

    expect(renderedTexts(renderer)).not.toContain('Could not refresh accounts — Connection lost')
    act(() => renderer.unmount())
  })
})
