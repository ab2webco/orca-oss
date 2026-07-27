import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ClaudeRefreshChainLeaseStore } from './claude-refresh-chain-lease'
import { shouldTrackClaudePtyCredentials } from './claude-pty-credential-location'
import { markClaudePtyExited, markInjectedClaudePtySpawned } from './live-pty-gate'
import { tryRunManagedClaudeAccountBackgroundRotation } from './run-managed-claude-account-mutation'

const roots: string[] = []

function credentials(refreshToken: string = randomUUID()): string {
  return JSON.stringify({ claudeAiOauth: { refreshToken } })
}

function leaseStore(): ClaudeRefreshChainLeaseStore {
  const rootPath = mkdtempSync(join(tmpdir(), 'orca-background-rotation-test-'))
  roots.push(rootPath)
  return new ClaudeRefreshChainLeaseStore({ rootPath })
}

describe('managed Claude background rotation', () => {
  afterEach(() => {
    markClaudePtyExited('live-alias')
    markClaudePtyExited('live-account')
    for (const root of roots.splice(0)) {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('refuses an inactive account that shares a refresh chain with a live session', async () => {
    const sharedCredentials = credentials()
    const operation = vi.fn(async () => 'rotated')
    markInjectedClaudePtySpawned('live-alias', 'account-live')

    const result = await tryRunManagedClaudeAccountBackgroundRotation(
      'account-inactive',
      sharedCredentials,
      operation,
      {
        leaseStore: leaseStore(),
        readManagedCredentials: async () => sharedCredentials
      }
    )

    expect(result).toEqual({ acquired: false })
    expect(operation).not.toHaveBeenCalled()
  })

  it('allows an inactive account whose refresh chain differs from every live session', async () => {
    const liveCredentials = credentials()
    const inactiveCredentials = credentials()
    markInjectedClaudePtySpawned('live-alias', 'account-live')

    const result = await tryRunManagedClaudeAccountBackgroundRotation(
      'account-inactive',
      inactiveCredentials,
      async () => 'rotated',
      {
        leaseStore: leaseStore(),
        readManagedCredentials: async () => liveCredentials
      }
    )

    expect(result).toEqual({ acquired: true, value: 'rotated' })
  })

  it('refuses rotation when a live account fingerprint cannot be determined', async () => {
    const operation = vi.fn(async () => 'rotated')
    markInjectedClaudePtySpawned('live-alias', 'account-live')

    const result = await tryRunManagedClaudeAccountBackgroundRotation(
      'account-inactive',
      credentials(),
      operation,
      {
        leaseStore: leaseStore(),
        readManagedCredentials: async () => null
      }
    )

    expect(result).toEqual({ acquired: false })
    expect(operation).not.toHaveBeenCalled()
  })

  it('refuses rotation when the candidate fingerprint cannot be determined', async () => {
    const operation = vi.fn(async () => 'rotated')

    const result = await tryRunManagedClaudeAccountBackgroundRotation(
      'account-inactive',
      JSON.stringify({ claudeAiOauth: {} }),
      operation,
      { leaseStore: leaseStore() }
    )

    expect(result).toEqual({ acquired: false })
    expect(operation).not.toHaveBeenCalled()
  })

  it('keeps the account-id gate for a live non-aliased account', async () => {
    markInjectedClaudePtySpawned('live-account', 'account-live')
    const operation = vi.fn(async () => 'rotated')

    const result = await tryRunManagedClaudeAccountBackgroundRotation(
      'account-live',
      credentials(),
      operation,
      {
        leaseStore: leaseStore(),
        readManagedCredentials: async () => credentials()
      }
    )

    expect(result).toEqual({ acquired: false })
    expect(operation).not.toHaveBeenCalled()
  })

  it('does not let an SSH or workspace-VM session block unrelated local rotation', async () => {
    expect(shouldTrackClaudePtyCredentials({ credentialLocation: 'remote' })).toBe(false)

    const result = await tryRunManagedClaudeAccountBackgroundRotation(
      'account-local',
      credentials(),
      async () => 'rotated',
      {
        leaseStore: leaseStore(),
        inspectAliases: async () => ({ status: 'unique' })
      }
    )

    expect(result).toEqual({ acquired: true, value: 'rotated' })
  })

  it('blocks every automatic rotation for a detected aliased chain', async () => {
    const operation = vi.fn(async () => 'rotated')

    const result = await tryRunManagedClaudeAccountBackgroundRotation(
      'account-alias',
      credentials(),
      operation,
      {
        leaseStore: leaseStore(),
        inspectAliases: async () => ({
          status: 'alias-conflict',
          accountIds: ['account-alias', 'account-other']
        })
      }
    )

    expect(result).toEqual({ acquired: false, reason: 'refresh-chain-alias' })
    expect(operation).not.toHaveBeenCalled()
  })
})
