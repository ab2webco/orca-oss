import { describe, expect, it } from 'vitest'
import type { CodexManagedAccountSummary } from '../../../shared/types'
import type { ExecutionHostId } from '../../../shared/execution-host'
import {
  filterCodexAccountsByRuntime,
  filterCodexAccountsByWorktreeRuntimes,
  isLocalCodexAccountWorktreeTarget,
  canPinCodexAccountToWorktree
} from './codex-account-runtime-filter'

function account(
  id: string,
  managedHomeRuntime: 'host' | 'wsl',
  wslDistro: string | null = null
): CodexManagedAccountSummary {
  return {
    id,
    email: `${id}@example.com`,
    managedHomeRuntime,
    wslDistro,
    createdAt: 1,
    updatedAt: 1,
    lastAuthenticatedAt: 1
  }
}

describe('Codex account runtime filtering', () => {
  const accounts = [account('host', 'host'), account('ubuntu', 'wsl', 'Ubuntu')]

  it('filters host accounts for host targets and WSL accounts for matching distros', () => {
    expect(
      filterCodexAccountsByRuntime(accounts, 'C:\\repo', { kind: 'host' }).map((entry) => entry.id)
    ).toEqual(['host'])
    expect(
      filterCodexAccountsByRuntime(accounts, 'C:\\repo', {
        kind: 'wsl',
        distro: 'Ubuntu'
      }).map((entry) => entry.id)
    ).toEqual(['ubuntu'])
  })

  it('returns no accounts for an unavailable launch runtime', () => {
    expect(filterCodexAccountsByRuntime(accounts, 'C:\\repo', { kind: 'unavailable' })).toEqual([])
  })

  it('requires one account to match every worktree in a batch', () => {
    expect(
      filterCodexAccountsByWorktreeRuntimes(accounts, [
        { path: 'C:\\host', launchRuntime: { kind: 'host' } },
        { path: 'C:\\wsl', launchRuntime: { kind: 'wsl', distro: 'Ubuntu' } }
      ])
    ).toEqual([])
  })

  it('does not offer an unresolved default-WSL account to every concrete distro', () => {
    const legacyDefault = account('legacy-default', 'wsl', null)

    expect(
      filterCodexAccountsByRuntime([legacyDefault], 'C:\\repo', {
        kind: 'wsl',
        distro: 'Debian'
      })
    ).toEqual([])
  })
})

describe('Codex account binding target ownership', () => {
  const localRepo = { connectionId: null, executionHostId: 'local' as const }

  it('allows raw local worktree ids but rejects runtime-owned and folder workspaces', () => {
    expect(isLocalCodexAccountWorktreeTarget({ id: 'repo-1::/tmp/worktree' }, localRepo)).toBe(true)
    expect(
      isLocalCodexAccountWorktreeTarget(
        { id: 'repo-1::/tmp/runtime-worktree', hostId: 'runtime:env-1' },
        localRepo
      )
    ).toBe(false)
    expect(isLocalCodexAccountWorktreeTarget({ id: 'folder:folder-workspace-1' }, localRepo)).toBe(
      false
    )
  })
})

describe('canPinCodexAccountToWorktree', () => {
  const localRepo = { connectionId: null, executionHostId: 'local' as const }

  // Same reasoning as the Claude twin: a runtime-owned worktree has that
  // runtime's vaults, so the pin means something there. Gating on "local" hid
  // the assign submenu for a server-hosted workspace.
  // Why the tuple is typed: `it.each` widens the literals to `string`, and
  // `Worktree.hostId` is the narrower `ExecutionHostId`.
  it.each<[string, ExecutionHostId | undefined, boolean]>([
    ['a paired runtime', 'runtime:env-1', true],
    ['the local host', undefined, true],
    ['an SSH connection', 'ssh:my-box', false]
  ])('accepts %s: %s', (_name, hostId, expected) => {
    expect(
      canPinCodexAccountToWorktree(
        { id: 'repo-1::/home/dev/worktree', ...(hostId ? { hostId } : {}) },
        localRepo
      )
    ).toBe(expected)
  })

  it('rejects a folder workspace, whose id is a workspace key', () => {
    expect(canPinCodexAccountToWorktree({ id: 'folder:folder-workspace-1' }, localRepo)).toBe(false)
  })
})
