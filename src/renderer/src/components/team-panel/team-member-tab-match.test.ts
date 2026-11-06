import { describe, expect, it } from 'vitest'
import { toRemoteRuntimePtyId } from '@/runtime/runtime-terminal-stream'
import type { TeamMemberCard } from '../../../../shared/team-panel-model-types'
import {
  isMemberInTab,
  isRemoteMemberWorktreeActive,
  type TeamTabState
} from './team-member-tab-match'

const LEAF = '7f3c1e2a-4b5d-4c6e-8f90-a1b2c3d4e5f6'

const card = (overrides: Partial<TeamMemberCard>): TeamMemberCard =>
  ({
    name: 'Squire',
    paneKey: `host-tab:${LEAF}`,
    terminalHandle: 'term_squire',
    worktreeId: 'host-wt',
    host: { kind: 'remote', name: 'mini', environmentId: 'env-mini', reachable: true },
    ...overrides
  }) as TeamMemberCard

// The window mirrors the host's terminal under its own tab id, keyed by handle and environment.
const mirrored = (ptyId: string, extra: Partial<TeamTabState> = {}): TeamTabState => ({
  tabsByWorktree: { 'host-wt': [{ id: 'local-tab' }] } as unknown as TeamTabState['tabsByWorktree'],
  ptyIdsByTabId: {},
  terminalLayoutsByTabId: {
    'local-tab': { ptyIdsByLeafId: { leaf: ptyId }, activeLeafId: 'leaf' }
  } as unknown as TeamTabState['terminalLayoutsByTabId'],
  activeWorktreeId: 'host-wt',
  activeWorkspaceExecutionHostId: 'runtime:env-mini',
  ...extra
})

describe('isMemberInTab', () => {
  it("finds a paired host's member in the tab that mirrors its terminal", () => {
    const state = mirrored(toRemoteRuntimePtyId('term_squire', 'env-mini'))

    expect(isMemberInTab(card({}), 'local-tab', state)).toBe(true)
    expect(isMemberInTab(card({}), 'host-tab', state)).toBe(false)
  })

  it('never takes the same handle on another paired host', () => {
    const state = mirrored(toRemoteRuntimePtyId('term_squire', 'env-other'))

    expect(isMemberInTab(card({}), 'local-tab', state)).toBe(false)
  })

  it('cannot place a remote member whose host gave no environment', () => {
    const state = mirrored(toRemoteRuntimePtyId('term_squire', 'env-mini'))
    const unpaired = card({
      host: { kind: 'remote', name: 'mini', environmentId: null, reachable: true }
    })

    expect(isMemberInTab(unpaired, 'local-tab', state)).toBe(false)
  })

  it('places a local member by its pane key', () => {
    const local = card({ paneKey: `local-tab:${LEAF}`, host: { kind: 'local' } })

    expect(isMemberInTab(local, 'local-tab', mirrored('pty-1'))).toBe(true)
  })
})

describe('isRemoteMemberWorktreeActive', () => {
  it("holds while the member's worktree on its host is active, before its tab mirrors", () => {
    expect(isRemoteMemberWorktreeActive([card({})], mirrored('unrelated'))).toBe(true)
  })

  it('holds on the mirrored terminal when an older host reports no worktree', () => {
    const state = mirrored(toRemoteRuntimePtyId('term_squire', 'env-mini'))

    expect(isRemoteMemberWorktreeActive([card({ worktreeId: null })], state)).toBe(true)
    expect(isRemoteMemberWorktreeActive([card({ worktreeId: null })], mirrored('unrelated'))).toBe(
      false
    )
  })

  it('lets go on a local worktree or another host', () => {
    expect(
      isRemoteMemberWorktreeActive(
        [card({})],
        mirrored('x', { activeWorkspaceExecutionHostId: 'local' })
      )
    ).toBe(false)
    expect(
      isRemoteMemberWorktreeActive(
        [card({})],
        mirrored('x', { activeWorkspaceExecutionHostId: 'runtime:env-other' })
      )
    ).toBe(false)
    expect(
      isRemoteMemberWorktreeActive([card({})], mirrored('x', { activeWorktreeId: 'other-wt' }))
    ).toBe(false)
  })
})
