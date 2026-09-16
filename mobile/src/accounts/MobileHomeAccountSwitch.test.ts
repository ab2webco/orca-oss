import { readFileSync } from 'node:fs'
import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { decodeAccountsSnapshot, type AccountsSnapshot } from '../components/account-usage-state'
import type { HostProfile } from '../transport/types'
import { MobileHomeAccountSwitch } from './MobileHomeAccountSwitch'

const homeSource = readFileSync(new URL('../../app/index.tsx', import.meta.url), 'utf8')

vi.mock('react-native', () => ({
  Pressable: 'Pressable',
  StyleSheet: { create: (styles: unknown) => styles },
  Text: 'Text',
  View: 'View'
}))

vi.mock('lucide-react-native', () => ({
  ChevronRight: 'ChevronRight'
}))

vi.mock('../components/AgentIcons', () => ({
  ClaudeIcon: 'ClaudeIcon',
  OpenAIIcon: 'OpenAIIcon'
}))

function host(id: string, name: string): HostProfile {
  return {
    id,
    name,
    endpoint: `ws://${id}.local:6768`,
    deviceToken: `token-${id}`,
    publicKeyB64: `key-${id}`,
    lastConnected: 1
  }
}

function snapshot(options: {
  claude?: { id: string; email: string }[]
  claudeActive?: string | null
  codex?: { id: string; email: string }[]
  codexActive?: string | null
}): AccountsSnapshot {
  // Why decode and not a cast: the fixture then fails on a schema drift instead of
  // typechecking against a shape the host would never send.
  return decodeAccountsSnapshot({
    claude: {
      accounts: (options.claude ?? []).map((account) => ({ ...account, updatedAt: 1 })),
      activeAccountId: options.claudeActive ?? null
    },
    codex: {
      accounts: (options.codex ?? []).map((account) => ({ ...account, updatedAt: 1 })),
      activeAccountId: options.codexActive ?? null
    },
    rateLimits: {
      claude: null,
      codex: null,
      inactiveClaudeAccounts: [],
      inactiveCodexAccounts: []
    }
  })
}

describe('MobileHomeAccountSwitch', () => {
  let renderer!: ReactTestRenderer

  afterEach(() => {
    act(() => renderer?.unmount())
    vi.restoreAllMocks()
  })

  async function renderSwitch(
    connectedHosts: HostProfile[],
    accountsByHost: Partial<Record<string, AccountsSnapshot>>
  ) {
    const onOpenAccounts = vi.fn()
    const consoleError = vi.spyOn(console, 'error').mockImplementation((...args) => {
      if (typeof args[0] !== 'string' || !args[0].includes('react-test-renderer is deprecated')) {
        throw new Error(String(args[0]))
      }
    })
    await act(async () => {
      renderer = create(
        createElement(MobileHomeAccountSwitch, {
          connectedHosts,
          accountsByHost,
          onOpenAccounts
        })
      )
    })
    consoleError.mockRestore()
    return { onOpenAccounts }
  }

  function switchRows() {
    return renderer.root.findAllByType('Pressable')
  }

  function texts() {
    return renderer.root.findAllByType('Text').map((node) => node.props.children)
  }

  it('offers a labelled switch that opens the accounts screen for the host', async () => {
    const callbacks = await renderSwitch([host('desk', 'Desk')], {
      desk: snapshot({ claude: [{ id: 'acc-1', email: 'fab@example.com' }], claudeActive: 'acc-1' })
    })

    expect(texts()).toContain('Switch account')
    expect(texts()).toContain('fab@example.com')

    act(() => switchRows()[0].props.onPress())

    expect(callbacks.onOpenAccounts).toHaveBeenCalledWith('desk')
  })

  it('names the host on each row when more than one is connected', async () => {
    await renderSwitch([host('desk', 'Desk'), host('laptop', 'Laptop')], {
      desk: snapshot({
        claude: [{ id: 'acc-1', email: 'fab@example.com' }],
        claudeActive: 'acc-1'
      }),
      laptop: snapshot({ claude: [{ id: 'acc-2', email: 'work@example.com' }] })
    })

    expect(switchRows()).toHaveLength(2)
    expect(texts()).toContain('Desk · fab@example.com')
    expect(texts()).toContain('Laptop · System default')
  })

  it('still offers the switch for a host whose snapshot never arrived', async () => {
    const callbacks = await renderSwitch([host('desk', 'Desk')], {})

    expect(texts()).toContain('Choose an account')

    act(() => switchRows()[0].props.onPress())

    expect(callbacks.onOpenAccounts).toHaveBeenCalledWith('desk')
  })

  it('falls back to the Codex identity when the host manages no Claude account', async () => {
    await renderSwitch([host('desk', 'Desk')], {
      desk: snapshot({ codex: [{ id: 'cdx-1', email: 'codex@example.com' }], codexActive: 'cdx-1' })
    })

    expect(texts()).toContain('codex@example.com')
    expect(renderer.root.findAllByType('OpenAIIcon')).toHaveLength(1)
  })

  it('renders nothing without a connected host', async () => {
    await renderSwitch([], {})

    expect(switchRows()).toHaveLength(0)
  })

  it('is mounted on the home screen through the cold-navigator-safe transition', () => {
    expect(homeSource).toContain('<MobileHomeAccountSwitch')
    expect(homeSource).toMatch(/onOpenAccounts=\{openMobileAccounts\}/)
  })
})
