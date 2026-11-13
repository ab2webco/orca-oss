import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ConnectionVerdict } from '../transport/connection-health'
import type { MobileConnectionPath } from '../transport/stable-logical-rpc-client'
import type { ConnectionState, HostCredentialStatus, HostProfile } from '../transport/types'
import {
  markHomeWorktreeCatalogUnavailable,
  type HostWorktreeInfo
} from '../worktree/home-worktree-info'
import type { HostTeamLine } from '../hosts/host-team-line'
import type { HostAccountLine } from '../hosts/host-account-line'
import { MobileHostCard } from './MobileHostCard'

vi.mock('react-native', () => ({
  Pressable: 'Pressable',
  StyleSheet: { create: <T,>(styles: T) => styles },
  Text: 'Text',
  View: 'View'
}))
vi.mock('lucide-react-native', () => ({
  Monitor: 'Monitor',
  MoreVertical: 'MoreVertical',
  Users: 'Users'
}))
vi.mock('./StatusDot', () => ({ StatusDot: 'StatusDot' }))

const host: HostProfile = {
  id: 'host-1',
  name: 'Studio',
  endpoint: 'ws://studio.local:8765',
  deviceToken: 'token',
  publicKeyB64: 'key',
  lastConnected: 0
}
const verdict: ConnectionVerdict = { kind: 'normal', label: 'Connected' }
const loaded: HostWorktreeInfo = {
  hostId: 'host-1',
  totalWorktrees: 12,
  activeCount: 2,
  lastActiveWorktree: null,
  countsProvenAt: Date.now()
}

describe('MobileHostCard', () => {
  let renderer: ReactTestRenderer | null = null

  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
  })

  async function renderCard(
    worktreeInfo: HostWorktreeInfo | undefined,
    overrides?: {
      state?: ConnectionState
      verdict?: ConnectionVerdict
      path?: MobileConnectionPath
      credentialStatus?: HostCredentialStatus
      teamLine?: HostTeamLine | null
      account?: HostAccountLine | null
      lastSeen?: string | null
    }
  ): Promise<string[]> {
    await act(async () => {
      renderer = create(
        createElement(MobileHostCard, {
          host,
          state: overrides?.state ?? 'connected',
          verdict: overrides?.verdict ?? verdict,
          path: overrides?.path ?? 'lan',
          credentialStatus: overrides?.credentialStatus,
          worktreeInfo,
          teamLine: overrides?.teamLine,
          account: overrides?.account,
          lastSeen: overrides?.lastSeen,
          onPress: () => {},
          onLongPress: () => {},
          onOpenActions: () => {}
        })
      )
    })
    return renderer!.root
      .findAllByType('Text')
      .flatMap((node) => node.children.filter((child) => typeof child === 'string'))
  }

  it('renders the counts the host proved', async () => {
    expect(await renderCard(loaded)).toContain('12 worktrees · 2 active')
  })

  it('keeps rendering the last proven counts after a failed refresh', async () => {
    // The regression this card shipped once: the caller dropped the counts the
    // failure path deliberately preserved.
    expect(await renderCard(markHomeWorktreeCatalogUnavailable(loaded, 'host-1'))).toContain(
      'Last known: 12 worktrees · 2 active'
    )
  })

  it('never asserts a count for a catalog that failed with nothing proven', async () => {
    expect(await renderCard(markHomeWorktreeCatalogUnavailable(undefined, 'host-1'))).toContain(
      'Worktree list unavailable'
    )
  })

  it('names the relay while the dial is still in flight', async () => {
    const lines = await renderCard(undefined, {
      state: 'connecting',
      verdict: { kind: 'normal', label: 'Connecting…' },
      path: 'relay'
    })

    expect(lines).toContain('Connecting…')
    expect(lines).toContain(' · Orca Relay')
  })

  it('names the relay while a failed direct dial is still retrying', async () => {
    const lines = await renderCard(undefined, {
      state: 'reconnecting',
      verdict: { kind: 'normal', label: 'Reconnecting…' },
      path: 'relay'
    })

    expect(lines).toContain(' · Orca Relay')
  })

  it('leaves an idle disconnected host unlabelled', async () => {
    const lines = await renderCard(undefined, {
      state: 'disconnected',
      verdict: { kind: 'normal', label: 'Disconnected' },
      path: 'relay'
    })

    expect(lines).not.toContain(' · Orca Relay')
  })

  it('does not guess a direct path before the dial resolves', async () => {
    const lines = await renderCard(undefined, {
      state: 'connecting',
      verdict: { kind: 'normal', label: 'Connecting…' },
      path: 'lan'
    })

    expect(lines).not.toContain(' · Direct · LAN')
  })

  it('shows no worktree line before the first read lands', async () => {
    const lines = await renderCard(undefined)

    expect(lines).not.toContain('0 worktrees')
    expect(lines).not.toContain('Worktree list unavailable')
  })

  it("draws the host's team: who needs you first, then members and who works", async () => {
    const lines = await renderCard(loaded, {
      teamLine: { members: 4, working: 2, needsYou: 1 }
    })

    expect(lines).toContain('1 needs you')
    expect(lines).toContain('4 members')
    expect(lines).toContain('2 working')
  })

  it('lets the team pieces wrap onto a new line instead of cutting them on a narrow phone', async () => {
    await renderCard(loaded, { teamLine: { members: 4, working: 2, needsYou: 1 } })

    const pieces = renderer!.root
      .findAllByType('Text')
      .filter((node) =>
        ['1 needs you', '4 members', '2 working'].includes(String(node.children[0]))
      )
    expect(pieces).toHaveLength(3)
    for (const piece of pieces) {
      expect(piece.props.numberOfLines).toBeUndefined()
    }
    const stack = renderer!.root.findAll(
      (node) => node.type === 'View' && node.props.style?.flexWrap === 'wrap'
    )
    expect(stack).toHaveLength(1)
    expect(stack[0]!.findAllByType('Text').map((node) => node.children[0])).toEqual([
      '1 needs you',
      '4 members',
      '2 working'
    ])
  })

  it('keeps the card as it is for a host that cannot say its team', async () => {
    const lines = await renderCard(loaded, { teamLine: null })

    expect(lines).toEqual(['Studio', 'Connected', ' · Direct · LAN', '12 worktrees · 2 active'])
  })

  it('shows a host the phone cannot reach as the last team it proved, never as live', async () => {
    const lines = await renderCard(loaded, {
      state: 'disconnected',
      verdict: { kind: 'unreachable', label: "Can't reach desktop" },
      teamLine: { members: 4, working: 2, needsYou: 1 },
      lastSeen: 'last seen 14:02'
    })

    expect(lines).toContain('Last known: 4 members · 2 working')
    expect(lines).toContain('last seen 14:02')
    expect(lines).not.toContain('1 needs you')
  })

  it('shows the active account and its 5 h percentage on a connected desktop', async () => {
    const lines = await renderCard(loaded, {
      account: { email: 'dev@example.com', fiveHourPercent: 38 }
    })

    expect(lines).toContain('dev@example.com')
    expect(lines).toContain('38%')
  })

  it('shows no account line for a host whose account is not known', async () => {
    const lines = await renderCard(loaded, { account: null })

    expect(lines).toEqual(['Studio', 'Connected', ' · Direct · LAN', '12 worktrees · 2 active'])
  })

  it('shows no account line for a disconnected host, which may have changed account since', async () => {
    const lines = await renderCard(loaded, {
      state: 'disconnected',
      verdict: { kind: 'unreachable', label: "Can't reach desktop" },
      account: { email: 'dev@example.com', fiveHourPercent: 38 }
    })

    expect(lines).not.toContain('dev@example.com')
  })

  it('offers re-pairing when the credential is missing', async () => {
    const lines = await renderCard(loaded, {
      state: 'connected',
      verdict: { kind: 'auth-failed', label: 'Pairing invalid' },
      credentialStatus: 'missing'
    })

    expect(lines).toContain('Pairing invalid')
    expect(lines).toContain('Tap to re-pair with your desktop')
    expect(lines).not.toContain('12 worktrees · 2 active')
  })

  it('offers a retry without declaring a transient read failure invalid', async () => {
    const lines = await renderCard(undefined, {
      state: 'disconnected',
      verdict: { kind: 'normal', label: 'Disconnected' },
      credentialStatus: 'temporarily-unavailable'
    })

    expect(lines).toContain('Pairing temporarily unavailable')
    expect(lines).toContain('Unlock your phone, then tap to retry')
    expect(lines).not.toContain('Pairing invalid')
  })
})
