import { describe, expect, it } from 'vitest'
import type { ClaudeManagedAccountSummary } from '../../../shared/types'
import {
  canOfferClaudeAccountPinForRepoTarget,
  filterClaudeAccountsByRuntime,
  filterClaudeAccountsByWorktreeRuntimes,
  isLocalClaudeAccountRepoTarget,
  isLocalClaudeAccountWorktreeTarget,
  canPinClaudeAccountToWorktree
} from './claude-account-runtime-filter'

function account(
  id: string,
  managedAuthRuntime: 'host' | 'wsl',
  wslDistro: string | null = null
): ClaudeManagedAccountSummary {
  return {
    id,
    email: `${id}@example.com`,
    managedAuthRuntime,
    wslDistro,
    authMethod: 'subscription-oauth',
    createdAt: 1,
    updatedAt: 1,
    lastAuthenticatedAt: 1
  }
}

describe('Claude account runtime filtering', () => {
  const accounts = [account('host', 'host'), account('ubuntu', 'wsl', 'Ubuntu')]

  it('uses the resolved project runtime instead of a Windows host path', () => {
    expect(
      filterClaudeAccountsByRuntime(accounts, 'C:\\repo', {
        kind: 'wsl',
        distro: 'Ubuntu'
      }).map((entry) => entry.id)
    ).toEqual(['ubuntu'])
  })

  it('requires one account to match every worktree in a batch', () => {
    expect(
      filterClaudeAccountsByWorktreeRuntimes(accounts, [
        { path: 'C:\\host', launchRuntime: { kind: 'host' } },
        { path: 'C:\\wsl', launchRuntime: { kind: 'wsl', distro: 'Ubuntu' } }
      ])
    ).toEqual([])
  })

  it('does not offer an unresolved default-WSL account to every concrete distro', () => {
    const legacyDefault = account('legacy-default', 'wsl', null)

    expect(
      filterClaudeAccountsByRuntime([legacyDefault], 'C:\\repo', {
        kind: 'wsl',
        distro: 'Debian'
      })
    ).toEqual([])
  })
})

describe('Claude account binding target ownership', () => {
  const localRepo = { connectionId: null, executionHostId: 'local' as const }
  const runtimeRepo = { connectionId: null, executionHostId: 'runtime:env-1' as const }

  it('uses repo execution-host ownership instead of global runtime focus', () => {
    expect(isLocalClaudeAccountRepoTarget(localRepo)).toBe(true)
    expect(isLocalClaudeAccountRepoTarget(runtimeRepo)).toBe(false)
  })

  it('loads account discovery only for local repo targets that can show the picker', () => {
    expect(
      canOfferClaudeAccountPinForRepoTarget({
        repo: localRepo,
        isFolderWorkspaceTarget: false,
        selectedRepoIsRemote: false,
        isPairedWebClient: false
      })
    ).toBe(true)
    expect(
      canOfferClaudeAccountPinForRepoTarget({
        repo: runtimeRepo,
        isFolderWorkspaceTarget: false,
        selectedRepoIsRemote: false,
        isPairedWebClient: false
      })
    ).toBe(false)
    expect(
      canOfferClaudeAccountPinForRepoTarget({
        repo: localRepo,
        isFolderWorkspaceTarget: true,
        selectedRepoIsRemote: false,
        isPairedWebClient: false
      })
    ).toBe(false)
    expect(
      canOfferClaudeAccountPinForRepoTarget({
        repo: localRepo,
        isFolderWorkspaceTarget: false,
        selectedRepoIsRemote: false,
        isPairedWebClient: true
      })
    ).toBe(false)
  })

  it('allows raw local worktree ids but rejects runtime-owned and folder workspaces', () => {
    expect(isLocalClaudeAccountWorktreeTarget({ id: 'repo-1::/tmp/worktree' }, localRepo)).toBe(
      true
    )
    expect(
      isLocalClaudeAccountWorktreeTarget(
        { id: 'repo-1::/tmp/runtime-worktree', hostId: 'runtime:env-1' },
        localRepo
      )
    ).toBe(false)
    expect(isLocalClaudeAccountWorktreeTarget({ id: 'folder:folder-workspace-1' }, localRepo)).toBe(
      false
    )
  })
})

describe('canPinClaudeAccountToWorktree', () => {
  const localRepo = { connectionId: null, executionHostId: 'local' as const }

  // Why this exists next to the local predicate: the pin names which managed
  // vault the agent launches against, and a runtime-owned worktree has vaults
  // of its own — that runtime's. Gating the affordance on "local" hid both the
  // assign submenu and the chip that says which account is in use, so a
  // server-hosted workspace had no way to pin one and no way to see one.
  it('accepts a worktree owned by a paired runtime', () => {
    expect(
      canPinClaudeAccountToWorktree(
        { id: 'repo-1::/home/dev/worktree', hostId: 'runtime:env-1' },
        localRepo
      )
    ).toBe(true)
  })

  it('still accepts a local worktree', () => {
    expect(canPinClaudeAccountToWorktree({ id: 'repo-1::/tmp/worktree' }, localRepo)).toBe(true)
  })

  // An SSH connection is not a runtime: its agent runs over a shell Orca keeps
  // no managed vault for, so a pin there would name nothing.
  it('rejects an SSH-hosted worktree', () => {
    expect(
      canPinClaudeAccountToWorktree(
        { id: 'repo-1::/home/dev/worktree', hostId: 'ssh:my-box' },
        localRepo
      )
    ).toBe(false)
  })

  it('rejects a folder workspace, whose id is a workspace key', () => {
    expect(canPinClaudeAccountToWorktree({ id: 'folder:folder-workspace-1' }, localRepo)).toBe(
      false
    )
  })
})
