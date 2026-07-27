/* eslint-disable max-lines -- Why: Claude rate-limit fallback tests share account/keychain/PTY mocks that would be noisier split apart. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fetchClaudeRateLimits, fetchManagedAccountUsage } from './claude-fetcher'
import { fetchViaPty } from './claude-pty'
import {
  deleteActiveClaudeKeychainCredentialsStrict,
  readActiveClaudeKeychainCredentials,
  readActiveClaudeKeychainCredentialsStrict,
  readManagedClaudeKeychainCredentials,
  writeActiveClaudeKeychainCredentials,
  writeManagedClaudeKeychainCredentials
} from '../claude-accounts/keychain'
import { noteLegacyClaudeKeychainSlotBlob } from '../claude-accounts/claude-legacy-keychain-slot-warning'
import type { ClaudeRuntimeAuthPreparation } from '../claude-accounts/runtime-auth-service'
import {
  releaseInjectedClaudeAccountLaunch,
  reserveInjectedClaudeAccountLaunch
} from '../claude-accounts/live-pty-gate'

const { netFetchMock, readFileMock, resolveProxyMock, setProxyMock, appGetPathMock } = vi.hoisted(
  () => ({
    netFetchMock: vi.fn(),
    readFileMock: vi.fn(),
    resolveProxyMock: vi.fn(),
    setProxyMock: vi.fn(),
    appGetPathMock: vi.fn()
  })
)

vi.mock('node:fs/promises', () => ({
  readFile: readFileMock
}))

vi.mock('electron', () => ({
  app: {
    getPath: appGetPathMock
  },
  net: {
    fetch: netFetchMock
  },
  session: {
    defaultSession: {
      resolveProxy: resolveProxyMock,
      setProxy: setProxyMock
    }
  }
}))

vi.mock('./claude-pty', () => ({
  fetchViaPty: vi.fn()
}))

vi.mock('../claude-accounts/claude-legacy-keychain-slot-warning', () => ({
  noteLegacyClaudeKeychainSlotBlob: vi.fn()
}))

vi.mock('../claude-accounts/keychain', () => ({
  deleteActiveClaudeKeychainCredentialsStrict: vi.fn(),
  readActiveClaudeKeychainCredentials: vi.fn(),
  readActiveClaudeKeychainCredentialsStrict: vi.fn(),
  readManagedClaudeKeychainCredentials: vi.fn(),
  writeActiveClaudeKeychainCredentials: vi.fn(),
  writeManagedClaudeKeychainCredentials: vi.fn()
}))

const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform')

function setPlatform(platform: NodeJS.Platform): void {
  Object.defineProperty(process, 'platform', {
    configurable: true,
    value: platform
  })
}

describe('fetchClaudeRateLimits', () => {
  let tempDir: string | null = null

  beforeEach(() => {
    setPlatform('darwin')
    tempDir = null
    vi.clearAllMocks()
    readFileMock.mockRejectedValue(new Error('missing file'))
    vi.mocked(readActiveClaudeKeychainCredentials).mockResolvedValue(null)
    vi.mocked(readActiveClaudeKeychainCredentialsStrict).mockResolvedValue(null)
    vi.mocked(readManagedClaudeKeychainCredentials).mockResolvedValue(null)
    vi.mocked(writeActiveClaudeKeychainCredentials).mockResolvedValue()
    vi.mocked(deleteActiveClaudeKeychainCredentialsStrict).mockResolvedValue()
    vi.mocked(writeManagedClaudeKeychainCredentials).mockResolvedValue()
    appGetPathMock.mockReturnValue('/tmp/orca-claude-fetcher-test')
    resolveProxyMock.mockResolvedValue('DIRECT')
    netFetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          five_hour: { utilization: 12 },
          seven_day: { utilization: 34 }
        }),
        { status: 200 }
      )
    )
    vi.mocked(fetchViaPty).mockResolvedValue({
      provider: 'claude',
      session: { usedPercent: 56, windowMinutes: 300, resetsAt: null, resetDescription: null },
      weekly: null,
      updatedAt: 1,
      error: null,
      status: 'ok'
    })
  })

  afterEach(() => {
    if (originalPlatform) {
      Object.defineProperty(process, 'platform', originalPlatform)
    }
    if (tempDir) {
      rmSync(tempDir, { recursive: true, force: true })
    }
  })

  it('does not read host credentials when WSL config resolution fails', async () => {
    await expect(
      fetchClaudeRateLimits({
        authPreparation: {
          configDir: '/Users/test/.claude',
          runtime: 'wsl',
          wslDistro: 'Ubuntu',
          wslLinuxConfigDir: null,
          envPatch: {},
          stripAuthEnv: true,
          provenance: 'wsl:Ubuntu:system'
        }
      })
    ).resolves.toMatchObject({
      provider: 'claude',
      status: 'error',
      error: 'WSL Claude config unavailable for Ubuntu'
    })

    expect(readFileMock).not.toHaveBeenCalled()
    expect(readActiveClaudeKeychainCredentialsStrict).not.toHaveBeenCalled()
    expect(fetchViaPty).not.toHaveBeenCalled()
  })

  it('reads scoped Keychain credentials when the Claude config dir is explicit', async () => {
    const configDir = '/Users/test/.claude'
    const authPreparation: ClaudeRuntimeAuthPreparation = {
      configDir,
      envPatch: { CLAUDE_CONFIG_DIR: configDir },
      stripAuthEnv: false,
      provenance: 'system'
    }
    vi.mocked(readActiveClaudeKeychainCredentialsStrict).mockResolvedValueOnce(
      JSON.stringify({
        claudeAiOauth: {
          accessToken: 'oauth-token',
          expiresAt: Date.now() + 60_000
        }
      })
    )
    readFileMock.mockResolvedValue(
      JSON.stringify({
        claudeAiOauth: {
          accessToken: 'file-oauth-token',
          expiresAt: Date.now() + 60_000
        }
      })
    )

    await expect(fetchClaudeRateLimits({ authPreparation })).resolves.toMatchObject({
      provider: 'claude',
      status: 'ok',
      session: { usedPercent: 12 },
      weekly: { usedPercent: 34 }
    })

    expect(readActiveClaudeKeychainCredentialsStrict).toHaveBeenCalledWith(configDir)
    expect(netFetchMock).toHaveBeenCalledWith(
      'https://api.anthropic.com/api/oauth/usage',
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer oauth-token',
          'User-Agent': 'claude-code/2.1.0'
        })
      })
    )
  })

  it('falls back to the legacy keychain token when the scoped token is rejected as stale', async () => {
    const configDir = '/Users/test/.claude'
    const authPreparation: ClaudeRuntimeAuthPreparation = {
      configDir,
      envPatch: { CLAUDE_CONFIG_DIR: configDir },
      stripAuthEnv: false,
      provenance: 'system'
    }
    vi.mocked(readActiveClaudeKeychainCredentialsStrict).mockImplementation(async (dir) =>
      dir
        ? JSON.stringify({
            claudeAiOauth: { accessToken: 'stale-scoped-token', refreshToken: 'refresh-1' }
          })
        : JSON.stringify({ claudeAiOauth: { accessToken: 'fresh-legacy-token' } })
    )
    netFetchMock.mockImplementation(async (_url: string, init?: RequestInit) => {
      const auth = (init?.headers as Record<string, string> | undefined)?.Authorization
      return auth === 'Bearer fresh-legacy-token'
        ? new Response(
            JSON.stringify({ five_hour: { utilization: 12 }, seven_day: { utilization: 34 } }),
            { status: 200 }
          )
        : new Response(
            JSON.stringify({ error: { message: 'Invalid authentication credentials' } }),
            { status: 401 }
          )
    })

    await expect(
      fetchClaudeRateLimits({ authPreparation, allowPtyFallback: false })
    ).resolves.toMatchObject({
      provider: 'claude',
      status: 'ok',
      session: { usedPercent: 12 },
      weekly: { usedPercent: 34 }
    })

    expect(netFetchMock).toHaveBeenCalledTimes(2)
    expect(fetchViaPty).not.toHaveBeenCalled()
  })

  it('prefers a legacy access token over scoped refresh-only credentials', async () => {
    const configDir = '/Users/test/.claude'
    const authPreparation: ClaudeRuntimeAuthPreparation = {
      configDir,
      envPatch: { CLAUDE_CONFIG_DIR: configDir },
      stripAuthEnv: false,
      provenance: 'system'
    }
    vi.mocked(readActiveClaudeKeychainCredentialsStrict).mockImplementation(async (dir) =>
      dir
        ? JSON.stringify({ claudeAiOauth: { refreshToken: 'refresh-only' } })
        : JSON.stringify({ claudeAiOauth: { accessToken: 'fresh-legacy-token' } })
    )

    await expect(fetchClaudeRateLimits({ authPreparation })).resolves.toMatchObject({
      provider: 'claude',
      status: 'ok',
      session: { usedPercent: 12 }
    })

    expect(netFetchMock).toHaveBeenCalledTimes(1)
    expect(netFetchMock).toHaveBeenCalledWith(
      'https://api.anthropic.com/api/oauth/usage',
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer fresh-legacy-token' })
      })
    )
  })

  it('keeps legacy-keychain credentials read-only and never routes them into OAuth refresh', async () => {
    const configDir = '/Users/test/.claude'
    const authPreparation: ClaudeRuntimeAuthPreparation = {
      configDir,
      runtime: 'host',
      envPatch: {},
      stripAuthEnv: false,
      provenance: 'system'
    }
    vi.mocked(readActiveClaudeKeychainCredentialsStrict).mockImplementation(async (dir) =>
      dir
        ? null
        : JSON.stringify({
            claudeAiOauth: {
              accessToken: 'legacy-usage-token',
              refreshToken: 'synthetic-refresh-credential'
            }
          })
    )

    await expect(
      fetchClaudeRateLimits({ authPreparation, allowPtyFallback: false })
    ).resolves.toMatchObject({
      provider: 'claude',
      status: 'ok',
      usageMetadata: { credentialSource: 'legacy-keychain' }
    })

    expect(netFetchMock.mock.calls).toHaveLength(1)
    expect(netFetchMock.mock.calls[0]?.[0]).toBe('https://api.anthropic.com/api/oauth/usage')
  })

  it('does not borrow the host legacy keychain token when managed scoped credentials are empty', async () => {
    const configDir = '/Users/test/managed-account'
    const authPreparation: ClaudeRuntimeAuthPreparation = {
      configDir,
      runtime: 'host',
      envPatch: { CLAUDE_CONFIG_DIR: configDir },
      stripAuthEnv: true,
      provenance: 'managed:account-1'
    }
    vi.mocked(readActiveClaudeKeychainCredentialsStrict).mockImplementation(async (dir) =>
      dir
        ? JSON.stringify({ claudeAiOauth: { refreshToken: '' } })
        : JSON.stringify({ claudeAiOauth: { accessToken: 'host-legacy-token' } })
    )

    await expect(
      fetchClaudeRateLimits({ authPreparation, allowPtyFallback: false })
    ).resolves.toMatchObject({
      provider: 'claude',
      status: 'unavailable',
      usageMetadata: {
        failureKind: 'missing-credentials',
        credentialSource: 'none'
      }
    })

    expect(readActiveClaudeKeychainCredentialsStrict).toHaveBeenCalledWith(configDir)
    expect(readActiveClaudeKeychainCredentialsStrict).not.toHaveBeenCalledWith(undefined)
    expect(netFetchMock).not.toHaveBeenCalled()
  })

  it('does not borrow the host legacy keychain token when a managed scoped token is dead', async () => {
    const configDir = '/Users/test/managed-account'
    const authPreparation: ClaudeRuntimeAuthPreparation = {
      configDir,
      runtime: 'host',
      envPatch: { CLAUDE_CONFIG_DIR: configDir },
      stripAuthEnv: true,
      provenance: 'managed:account-1'
    }
    vi.mocked(readActiveClaudeKeychainCredentialsStrict).mockImplementation(async (dir) =>
      dir
        ? JSON.stringify({ claudeAiOauth: { accessToken: 'dead-managed-token' } })
        : JSON.stringify({ claudeAiOauth: { accessToken: 'host-legacy-token' } })
    )
    netFetchMock.mockResolvedValue(
      new Response(JSON.stringify({ error: { message: 'Invalid authentication credentials' } }), {
        status: 401
      })
    )

    await expect(
      fetchClaudeRateLimits({ authPreparation, allowPtyFallback: false })
    ).resolves.toMatchObject({
      provider: 'claude',
      status: 'error',
      usageMetadata: {
        failureKind: 'stale-token',
        credentialSource: 'scoped-keychain'
      }
    })

    expect(readActiveClaudeKeychainCredentialsStrict).not.toHaveBeenCalledWith(undefined)
    expect(netFetchMock).toHaveBeenCalledTimes(1)
    expect(netFetchMock).toHaveBeenCalledWith(
      'https://api.anthropic.com/api/oauth/usage',
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer dead-managed-token' })
      })
    )
  })

  it('does not retry with the legacy keychain for managed account credentials', async () => {
    const configDir = '/Users/test/managed-account'
    const authPreparation: ClaudeRuntimeAuthPreparation = {
      configDir,
      envPatch: { CLAUDE_CONFIG_DIR: configDir },
      stripAuthEnv: true,
      provenance: 'managed:account-1'
    }
    vi.mocked(readActiveClaudeKeychainCredentialsStrict).mockImplementation(async (dir) =>
      dir ? JSON.stringify({ claudeAiOauth: { accessToken: 'stale-managed-token' } }) : null
    )
    netFetchMock.mockResolvedValue(
      new Response(JSON.stringify({ error: { message: 'Invalid authentication credentials' } }), {
        status: 401
      })
    )

    await expect(
      fetchClaudeRateLimits({ authPreparation, allowPtyFallback: false })
    ).resolves.toMatchObject({
      provider: 'claude',
      status: 'error'
    })

    expect(netFetchMock).toHaveBeenCalledTimes(1)
    expect(readActiveClaudeKeychainCredentialsStrict).not.toHaveBeenCalledWith(undefined)
  })

  it('does not retry with the legacy keychain for WSL targets', async () => {
    // Why: a WSL target's stale credentials must never be answered with the
    // host user's legacy macOS Keychain account.
    const configDir = '\\\\wsl$\\Ubuntu\\home\\test\\.claude'
    const authPreparation: ClaudeRuntimeAuthPreparation = {
      configDir,
      runtime: 'wsl',
      wslDistro: 'Ubuntu',
      wslLinuxConfigDir: '/home/test/.claude',
      envPatch: { CLAUDE_CONFIG_DIR: '/home/test/.claude' },
      stripAuthEnv: false,
      provenance: 'system'
    }
    vi.mocked(readActiveClaudeKeychainCredentialsStrict).mockImplementation(async (dir) =>
      dir
        ? JSON.stringify({ claudeAiOauth: { accessToken: 'stale-wsl-token' } })
        : JSON.stringify({ claudeAiOauth: { accessToken: 'fresh-legacy-token' } })
    )
    netFetchMock.mockResolvedValue(
      new Response(JSON.stringify({ error: { message: 'Invalid authentication credentials' } }), {
        status: 401
      })
    )

    await expect(
      fetchClaudeRateLimits({ authPreparation, allowPtyFallback: false })
    ).resolves.toMatchObject({
      provider: 'claude',
      status: 'error'
    })

    expect(netFetchMock).toHaveBeenCalledTimes(1)
    expect(readActiveClaudeKeychainCredentialsStrict).not.toHaveBeenCalledWith(undefined)
  })

  it('skips the legacy retry when the legacy item mirrors the failed scoped token', async () => {
    // Why: Claude's usage endpoint has a tight request budget; retrying the
    // identical token would double the request for a guaranteed second 401.
    const configDir = '/Users/test/.claude'
    const authPreparation: ClaudeRuntimeAuthPreparation = {
      configDir,
      envPatch: { CLAUDE_CONFIG_DIR: configDir },
      stripAuthEnv: false,
      provenance: 'system'
    }
    vi.mocked(readActiveClaudeKeychainCredentialsStrict).mockResolvedValue(
      JSON.stringify({ claudeAiOauth: { accessToken: 'mirrored-token' } })
    )
    netFetchMock.mockResolvedValue(
      new Response(JSON.stringify({ error: { message: 'Invalid authentication credentials' } }), {
        status: 401
      })
    )

    await expect(
      fetchClaudeRateLimits({ authPreparation, allowPtyFallback: false })
    ).resolves.toMatchObject({
      provider: 'claude',
      status: 'error'
    })

    expect(netFetchMock).toHaveBeenCalledTimes(1)
    expect(readActiveClaudeKeychainCredentialsStrict).toHaveBeenCalledWith(undefined)
  })

  it('accepts Claude Code statusline-style rate limit window fields', async () => {
    const configDir = '/Users/test/.claude'
    const authPreparation: ClaudeRuntimeAuthPreparation = {
      configDir,
      envPatch: { CLAUDE_CONFIG_DIR: configDir },
      stripAuthEnv: false,
      provenance: 'system'
    }
    vi.mocked(readActiveClaudeKeychainCredentialsStrict).mockResolvedValueOnce(
      JSON.stringify({
        claudeAiOauth: {
          accessToken: 'oauth-token',
          expiresAt: Date.now() + 60_000
        }
      })
    )
    netFetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          five_hour: { used_percentage: 23.5, resets_at: 1770000000 },
          seven_day: { used_percentage: 41.2, resets_at: 1770604800 },
          fable_weekly: { used_percentage: 12.3, resets_at: 1770691200 }
        }),
        { status: 200 }
      )
    )

    await expect(fetchClaudeRateLimits({ authPreparation })).resolves.toMatchObject({
      provider: 'claude',
      status: 'ok',
      session: { usedPercent: 23.5, resetsAt: 1770000000000 },
      weekly: { usedPercent: 41.2, resetsAt: 1770604800000 },
      fableWeekly: { usedPercent: 12.3, resetsAt: 1770691200000 }
    })
  })

  it('maps active Fable usage from the scoped OAuth limits array without a PTY read', async () => {
    const configDir = '/Users/test/.claude'
    const authPreparation: ClaudeRuntimeAuthPreparation = {
      configDir,
      envPatch: { CLAUDE_CONFIG_DIR: configDir },
      stripAuthEnv: false,
      provenance: 'managed:account-1'
    }
    vi.mocked(readActiveClaudeKeychainCredentialsStrict).mockResolvedValueOnce(
      JSON.stringify({ claudeAiOauth: { accessToken: 'oauth-token' } })
    )
    netFetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          five_hour: { utilization: 36 },
          seven_day: { utilization: 73 },
          fable_weekly: { utilization: 12 },
          limits: [
            { kind: 'weekly_scoped', percent: 55, scope: null },
            {
              kind: 'weekly_scoped',
              percent: 100,
              resets_at: '2026-07-17T20:00:00.099908+00:00',
              is_active: true,
              scope: { model: { display_name: 'Fable' } }
            }
          ]
        }),
        { status: 200 }
      )
    )

    await expect(
      fetchClaudeRateLimits({ authPreparation, allowUsagePanelSupplement: true })
    ).resolves.toMatchObject({
      provider: 'claude',
      status: 'ok',
      fableWeekly: {
        usedPercent: 100,
        resetsAt: Date.parse('2026-07-17T20:00:00.099908+00:00')
      },
      usageMetadata: { attemptedSources: ['oauth'] }
    })
    expect(fetchViaPty).not.toHaveBeenCalled()
  })

  it('surfaces inactive scoped Fable usage over the legacy OAuth fallback', async () => {
    const configDir = '/Users/test/.claude'
    const authPreparation: ClaudeRuntimeAuthPreparation = {
      configDir,
      envPatch: { CLAUDE_CONFIG_DIR: configDir },
      stripAuthEnv: false,
      provenance: 'system'
    }
    vi.mocked(readActiveClaudeKeychainCredentialsStrict).mockResolvedValueOnce(
      JSON.stringify({ claudeAiOauth: { accessToken: 'oauth-token' } })
    )
    netFetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          five_hour: { utilization: 11 },
          seven_day: { utilization: 22 },
          fable_weekly: { utilization: 33 },
          limits: [
            {
              kind: 'weekly_scoped',
              percent: 90,
              is_active: false,
              scope: { model: { display_name: 'fable' } }
            }
          ]
        }),
        { status: 200 }
      )
    )

    await expect(fetchClaudeRateLimits({ authPreparation })).resolves.toMatchObject({
      fableWeekly: { usedPercent: 90 }
    })
  })

  it('surfaces an inactive scoped Fable entry when no legacy Fable field exists (#8979)', async () => {
    const configDir = '/Users/test/.claude'
    const authPreparation: ClaudeRuntimeAuthPreparation = {
      configDir,
      envPatch: { CLAUDE_CONFIG_DIR: configDir },
      stripAuthEnv: false,
      provenance: 'system'
    }
    vi.mocked(readActiveClaudeKeychainCredentialsStrict).mockResolvedValueOnce(
      JSON.stringify({ claudeAiOauth: { accessToken: 'oauth-token' } })
    )
    netFetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          five_hour: { utilization: 11 },
          seven_day: { utilization: 22 },
          limits: [
            {
              kind: 'weekly_scoped',
              percent: 64,
              resets_at: '2026-07-24T20:00:00+00:00',
              is_active: false,
              scope: { model: { display_name: 'Fable' } }
            }
          ]
        }),
        { status: 200 }
      )
    )

    await expect(fetchClaudeRateLimits({ authPreparation })).resolves.toMatchObject({
      provider: 'claude',
      status: 'ok',
      fableWeekly: {
        usedPercent: 64,
        resetsAt: Date.parse('2026-07-24T20:00:00+00:00')
      }
    })
  })

  it('supplements managed-account OAuth usage with Fable from the CLI usage panel', async () => {
    const configDir = '/Users/test/.claude'
    const authPreparation: ClaudeRuntimeAuthPreparation = {
      configDir,
      envPatch: { CLAUDE_CONFIG_DIR: configDir },
      stripAuthEnv: false,
      provenance: 'managed:account-1'
    }
    vi.mocked(readActiveClaudeKeychainCredentialsStrict).mockResolvedValueOnce(
      JSON.stringify({
        claudeAiOauth: {
          accessToken: 'oauth-token',
          expiresAt: Date.now() + 60_000
        }
      })
    )
    netFetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          five_hour: { used_percentage: 23.5, resets_at: 1770000000 },
          seven_day: { used_percentage: 41.2, resets_at: 1770604800 }
        }),
        { status: 200 }
      )
    )
    vi.mocked(fetchViaPty).mockResolvedValueOnce({
      provider: 'claude',
      session: { usedPercent: 91, windowMinutes: 300, resetsAt: null, resetDescription: null },
      weekly: null,
      fableWeekly: {
        usedPercent: 12.3,
        windowMinutes: 10080,
        resetsAt: null,
        resetDescription: '3d 2h'
      },
      updatedAt: 1,
      error: null,
      status: 'ok'
    })

    await expect(fetchClaudeRateLimits({ authPreparation })).resolves.toMatchObject({
      provider: 'claude',
      status: 'ok',
      session: { usedPercent: 23.5, resetsAt: 1770000000000 },
      weekly: { usedPercent: 41.2, resetsAt: 1770604800000 },
      fableWeekly: { usedPercent: 12.3, resetDescription: '3d 2h' },
      usageMetadata: {
        source: 'oauth',
        attemptedSources: ['oauth', 'cli']
      }
    })
    expect(fetchViaPty).toHaveBeenCalledWith({ authPreparation })
  })

  it('supplements system OAuth usage when the service explicitly allows usage-panel reads', async () => {
    const configDir = '/Users/test/.claude'
    const authPreparation: ClaudeRuntimeAuthPreparation = {
      configDir,
      envPatch: { CLAUDE_CONFIG_DIR: configDir },
      stripAuthEnv: false,
      provenance: 'system'
    }
    vi.mocked(readActiveClaudeKeychainCredentialsStrict).mockResolvedValueOnce(
      JSON.stringify({
        claudeAiOauth: {
          accessToken: 'oauth-token',
          expiresAt: Date.now() + 60_000
        }
      })
    )
    vi.mocked(fetchViaPty).mockResolvedValueOnce({
      provider: 'claude',
      session: null,
      weekly: null,
      fableWeekly: {
        usedPercent: 58,
        windowMinutes: 10080,
        resetsAt: null,
        resetDescription: '4d'
      },
      updatedAt: 1,
      error: null,
      status: 'ok'
    })

    await expect(
      fetchClaudeRateLimits({
        authPreparation,
        allowPtyFallback: false,
        allowUsagePanelSupplement: true
      })
    ).resolves.toMatchObject({
      provider: 'claude',
      status: 'ok',
      session: { usedPercent: 12 },
      weekly: { usedPercent: 34 },
      fableWeekly: { usedPercent: 58, resetDescription: '4d' },
      usageMetadata: {
        source: 'oauth',
        attemptedSources: ['oauth', 'cli']
      }
    })
    expect(fetchViaPty).toHaveBeenCalledWith({ authPreparation })
  })

  it('ignores bare Fable OAuth usage because the window length is ambiguous', async () => {
    const configDir = '/Users/test/.claude'
    const authPreparation: ClaudeRuntimeAuthPreparation = {
      configDir,
      envPatch: { CLAUDE_CONFIG_DIR: configDir },
      stripAuthEnv: false,
      provenance: 'system'
    }
    vi.mocked(readActiveClaudeKeychainCredentialsStrict).mockResolvedValueOnce(
      JSON.stringify({
        claudeAiOauth: {
          accessToken: 'oauth-token',
          expiresAt: Date.now() + 60_000
        }
      })
    )
    netFetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          five_hour: { utilization: 11 },
          seven_day: { utilization: 22 },
          fable: { utilization: 33 }
        }),
        { status: 200 }
      )
    )

    await expect(fetchClaudeRateLimits({ authPreparation })).resolves.toMatchObject({
      provider: 'claude',
      status: 'ok',
      session: { usedPercent: 11 },
      weekly: { usedPercent: 22 },
      fableWeekly: null
    })
  })

  it('falls back to legacy Keychain credentials for host system default without an explicit config dir', async () => {
    const configDir = '/Users/test/.claude'
    const authPreparation: ClaudeRuntimeAuthPreparation = {
      configDir,
      runtime: 'host',
      envPatch: {},
      stripAuthEnv: false,
      provenance: 'system'
    }
    vi.mocked(readActiveClaudeKeychainCredentialsStrict)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(
        JSON.stringify({
          claudeAiOauth: {
            accessToken: 'legacy-oauth-token',
            expiresAt: Date.now() + 60_000
          }
        })
      )

    await expect(fetchClaudeRateLimits({ authPreparation })).resolves.toMatchObject({
      provider: 'claude',
      status: 'ok',
      session: { usedPercent: 12 },
      weekly: { usedPercent: 34 }
    })

    expect(readActiveClaudeKeychainCredentialsStrict).toHaveBeenNthCalledWith(1, configDir)
    expect(readActiveClaudeKeychainCredentialsStrict).toHaveBeenNthCalledWith(2, undefined)
    expect(readActiveClaudeKeychainCredentials).not.toHaveBeenCalled()
    expect(netFetchMock).toHaveBeenCalledWith(
      'https://api.anthropic.com/api/oauth/usage',
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer legacy-oauth-token'
        })
      })
    )
  })

  it('borrows the legacy keychain token only for the host global account when its scoped item is empty', async () => {
    const configDir = '/Users/test/.claude'
    const authPreparation: ClaudeRuntimeAuthPreparation = {
      configDir,
      runtime: 'host',
      envPatch: {},
      stripAuthEnv: false,
      provenance: 'system'
    }
    vi.mocked(readActiveClaudeKeychainCredentialsStrict).mockImplementation(async (dir) =>
      dir
        ? JSON.stringify({ claudeAiOauth: { refreshToken: '' } })
        : JSON.stringify({ claudeAiOauth: { accessToken: 'host-legacy-token' } })
    )

    await expect(
      fetchClaudeRateLimits({ authPreparation, allowPtyFallback: false })
    ).resolves.toMatchObject({
      provider: 'claude',
      status: 'ok',
      session: { usedPercent: 12 },
      weekly: { usedPercent: 34 },
      usageMetadata: { credentialSource: 'legacy-keychain' }
    })

    expect(readActiveClaudeKeychainCredentialsStrict).toHaveBeenNthCalledWith(1, configDir)
    expect(readActiveClaudeKeychainCredentialsStrict).toHaveBeenNthCalledWith(2, undefined)
  })

  it('notes the machine-wide slot blob it observes so an unusable one can warn the user', async () => {
    const configDir = '/Users/test/.claude'
    const authPreparation: ClaudeRuntimeAuthPreparation = {
      configDir,
      runtime: 'host',
      envPatch: {},
      stripAuthEnv: false,
      provenance: 'system'
    }
    const brokenLegacyBlob = JSON.stringify({
      claudeAiOauth: { accessToken: 'expired-access', refreshToken: '', expiresAt: 1 }
    })
    vi.mocked(readActiveClaudeKeychainCredentialsStrict).mockImplementation(async (dir) =>
      dir ? null : brokenLegacyBlob
    )

    await fetchClaudeRateLimits({ authPreparation, allowPtyFallback: false })

    expect(noteLegacyClaudeKeychainSlotBlob).toHaveBeenCalledWith(brokenLegacyBlob)
  })

  it('reads scoped Keychain credentials for host system default without an explicit config dir', async () => {
    const configDir = '/Users/test/.claude'
    const authPreparation: ClaudeRuntimeAuthPreparation = {
      configDir,
      runtime: 'host',
      envPatch: {},
      stripAuthEnv: false,
      provenance: 'system'
    }
    vi.mocked(readActiveClaudeKeychainCredentialsStrict).mockResolvedValueOnce(
      JSON.stringify({
        claudeAiOauth: {
          accessToken: 'scoped-oauth-token',
          expiresAt: Date.now() + 60_000
        }
      })
    )

    await expect(
      fetchClaudeRateLimits({ authPreparation, allowPtyFallback: false })
    ).resolves.toMatchObject({
      provider: 'claude',
      status: 'ok',
      session: { usedPercent: 12 },
      weekly: { usedPercent: 34 }
    })

    expect(readActiveClaudeKeychainCredentialsStrict).toHaveBeenCalledWith(configDir)
    expect(readActiveClaudeKeychainCredentials).not.toHaveBeenCalled()
    expect(fetchViaPty).not.toHaveBeenCalled()
    expect(netFetchMock).toHaveBeenCalledWith(
      'https://api.anthropic.com/api/oauth/usage',
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer scoped-oauth-token'
        })
      })
    )
  })

  it('falls back to the credentials file when Keychain access fails', async () => {
    const configDir = '/Users/test/.claude'
    const authPreparation: ClaudeRuntimeAuthPreparation = {
      configDir,
      envPatch: { CLAUDE_CONFIG_DIR: configDir },
      stripAuthEnv: false,
      provenance: 'system'
    }
    vi.mocked(readActiveClaudeKeychainCredentialsStrict).mockRejectedValue(
      new Error('Keychain locked')
    )
    readFileMock.mockResolvedValue(
      JSON.stringify({
        claudeAiOauth: {
          accessToken: 'file-oauth-token',
          expiresAt: Date.now() + 60_000
        }
      })
    )

    await expect(fetchClaudeRateLimits({ authPreparation })).resolves.toMatchObject({
      provider: 'claude',
      status: 'ok'
    })

    expect(readFileMock).toHaveBeenCalledWith(
      join('/Users/test/.claude', '.credentials.json'),
      'utf-8'
    )
    expect(netFetchMock).toHaveBeenCalledWith(
      'https://api.anthropic.com/api/oauth/usage',
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer file-oauth-token'
        })
      })
    )
  })

  it('falls back to legacy Keychain when scoped credentials are unusable', async () => {
    const configDir = '/Users/test/.claude'
    const authPreparation: ClaudeRuntimeAuthPreparation = {
      configDir,
      envPatch: { CLAUDE_CONFIG_DIR: configDir },
      stripAuthEnv: false,
      provenance: 'system'
    }
    vi.mocked(readActiveClaudeKeychainCredentialsStrict)
      .mockResolvedValueOnce('{not-json')
      .mockResolvedValueOnce(
        JSON.stringify({
          claudeAiOauth: {
            accessToken: 'legacy-oauth-token',
            expiresAt: Date.now() + 60_000
          }
        })
      )

    await expect(fetchClaudeRateLimits({ authPreparation })).resolves.toMatchObject({
      provider: 'claude',
      status: 'ok'
    })

    expect(readActiveClaudeKeychainCredentialsStrict).toHaveBeenNthCalledWith(1, configDir)
    expect(readActiveClaudeKeychainCredentialsStrict).toHaveBeenNthCalledWith(2, undefined)
    expect(netFetchMock).toHaveBeenCalledWith(
      'https://api.anthropic.com/api/oauth/usage',
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer legacy-oauth-token'
        })
      })
    )
  })

  it('tries OAuth usage even when local credential metadata is expired', async () => {
    const configDir = '/Users/test/.claude'
    const authPreparation: ClaudeRuntimeAuthPreparation = {
      configDir,
      envPatch: { CLAUDE_CONFIG_DIR: configDir },
      stripAuthEnv: false,
      provenance: 'system'
    }
    vi.mocked(readActiveClaudeKeychainCredentialsStrict).mockResolvedValueOnce(
      JSON.stringify({
        claudeAiOauth: {
          accessToken: 'expired-oauth-token',
          refreshToken: 'refresh-token',
          expiresAt: Date.now() - 60_000
        }
      })
    )

    await expect(fetchClaudeRateLimits({ authPreparation })).resolves.toMatchObject({
      provider: 'claude',
      status: 'ok',
      session: { usedPercent: 12 }
    })

    expect(netFetchMock).toHaveBeenNthCalledWith(
      1,
      'https://api.anthropic.com/api/oauth/usage',
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer expired-oauth-token'
        })
      })
    )
    expect(readFileMock).not.toHaveBeenCalled()
    expect(fetchViaPty).not.toHaveBeenCalled()
  })

  it('does not mask OAuth usage rate limits with the PTY fallback', async () => {
    const configDir = '/Users/test/.claude'
    const authPreparation: ClaudeRuntimeAuthPreparation = {
      configDir,
      envPatch: { CLAUDE_CONFIG_DIR: configDir },
      stripAuthEnv: false,
      provenance: 'system'
    }
    vi.mocked(readActiveClaudeKeychainCredentialsStrict).mockResolvedValueOnce(
      JSON.stringify({
        claudeAiOauth: {
          accessToken: 'expired-oauth-token',
          refreshToken: 'refresh-token',
          expiresAt: Date.now() - 60_000
        }
      })
    )
    netFetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          error: {
            type: 'rate_limit_error',
            message: 'Rate limited. Please try again later.'
          }
        }),
        { status: 429, headers: { 'retry-after': '3000' } }
      )
    )

    const before = Date.now()
    const result = await fetchClaudeRateLimits({ authPreparation })
    expect(result).toMatchObject({
      provider: 'claude',
      status: 'error',
      error: 'Claude usage is rate limited right now.',
      usageMetadata: expect.objectContaining({ failureKind: 'rate-limited' })
    })
    expect(result.usageMetadata?.retryAtMs).toBeGreaterThanOrEqual(before + 3000 * 1000)
    expect(result.usageMetadata?.retryAtMs).toBeLessThanOrEqual(Date.now() + 3000 * 1000)

    expect(netFetchMock).toHaveBeenCalledWith(
      'https://api.anthropic.com/api/oauth/usage',
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer expired-oauth-token'
        })
      })
    )
    expect(fetchViaPty).not.toHaveBeenCalled()
  })

  it('omits retryAtMs when a 429 has no Retry-After header', async () => {
    const configDir = '/Users/test/.claude'
    const authPreparation: ClaudeRuntimeAuthPreparation = {
      configDir,
      envPatch: { CLAUDE_CONFIG_DIR: configDir },
      stripAuthEnv: false,
      provenance: 'system'
    }
    vi.mocked(readActiveClaudeKeychainCredentialsStrict).mockResolvedValueOnce(
      JSON.stringify({
        claudeAiOauth: {
          accessToken: 'expired-oauth-token',
          refreshToken: 'refresh-token',
          expiresAt: Date.now() - 60_000
        }
      })
    )
    netFetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          error: {
            type: 'rate_limit_error',
            message: 'Rate limited. Please try again later.'
          }
        }),
        { status: 429 }
      )
    )

    const result = await fetchClaudeRateLimits({ authPreparation })
    expect(result.status).toBe('error')
    expect(result.usageMetadata?.retryAtMs).toBeUndefined()
    expect(fetchViaPty).not.toHaveBeenCalled()
  })

  it('uses CLI fallback for OAuth auth failures when automatic repair is safe', async () => {
    const configDir = '/Users/test/.claude'
    const authPreparation: ClaudeRuntimeAuthPreparation = {
      configDir,
      envPatch: { CLAUDE_CONFIG_DIR: configDir },
      stripAuthEnv: false,
      provenance: 'system'
    }
    vi.mocked(readActiveClaudeKeychainCredentialsStrict).mockResolvedValueOnce(
      JSON.stringify({
        claudeAiOauth: {
          accessToken: 'stale-oauth-token',
          refreshToken: 'refresh-token',
          expiresAt: Date.now() - 60_000
        }
      })
    )
    netFetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          error: {
            type: 'authentication_error',
            message: 'Invalid OAuth token.'
          }
        }),
        { status: 401 }
      )
    )

    await expect(fetchClaudeRateLimits({ authPreparation })).resolves.toMatchObject({
      provider: 'claude',
      status: 'ok',
      session: { usedPercent: 56 },
      usageMetadata: {
        source: 'cli',
        attemptedSources: ['oauth', 'cli']
      }
    })

    expect(fetchViaPty).toHaveBeenCalledWith({ authPreparation })
  })

  it('re-reads credentials and retries OAuth once after CLI repair', async () => {
    const configDir = '/Users/test/.claude'
    const authPreparation: ClaudeRuntimeAuthPreparation = {
      configDir,
      envPatch: { CLAUDE_CONFIG_DIR: configDir },
      stripAuthEnv: false,
      provenance: 'system'
    }
    vi.mocked(readActiveClaudeKeychainCredentialsStrict)
      .mockResolvedValueOnce(
        JSON.stringify({
          claudeAiOauth: {
            accessToken: 'stale-oauth-token',
            refreshToken: 'refresh-token',
            expiresAt: Date.now() - 60_000
          }
        })
      )
      // Legacy item absent — the stale-scoped legacy fallback must not preempt
      // CLI repair in this scenario.
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(
        JSON.stringify({
          claudeAiOauth: {
            accessToken: 'repaired-oauth-token',
            refreshToken: 'refresh-token-2',
            expiresAt: Date.now() + 60_000
          }
        })
      )
    netFetchMock
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            error: {
              type: 'authentication_error',
              message: 'Invalid OAuth token.'
            }
          }),
          { status: 401 }
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            five_hour: { utilization: 14 },
            seven_day: { utilization: 27 }
          }),
          { status: 200 }
        )
      )

    await expect(fetchClaudeRateLimits({ authPreparation })).resolves.toMatchObject({
      provider: 'claude',
      status: 'ok',
      session: { usedPercent: 14 },
      weekly: { usedPercent: 27 },
      usageMetadata: {
        source: 'oauth',
        attemptedSources: ['oauth', 'cli'],
        credentialSource: 'scoped-keychain'
      }
    })

    expect(fetchViaPty).toHaveBeenCalledWith({ authPreparation })
    expect(netFetchMock).toHaveBeenNthCalledWith(
      2,
      'https://api.anthropic.com/api/oauth/usage',
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer repaired-oauth-token'
        })
      })
    )
  })

  it('explains auth failures when a live Claude terminal owns managed refresh', async () => {
    const configDir = '/Users/test/.claude'
    const authPreparation: ClaudeRuntimeAuthPreparation = {
      configDir,
      envPatch: { CLAUDE_CONFIG_DIR: configDir },
      stripAuthEnv: false,
      managedRefreshDeferredByLivePty: true,
      provenance: 'managed:account-1'
    }
    vi.mocked(readActiveClaudeKeychainCredentialsStrict).mockResolvedValueOnce(
      JSON.stringify({
        claudeAiOauth: {
          accessToken: 'stale-oauth-token',
          refreshToken: 'refresh-token',
          expiresAt: Date.now() - 60_000
        }
      })
    )
    netFetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          error: {
            type: 'authentication_error',
            message: 'Invalid OAuth token.'
          }
        }),
        { status: 401 }
      )
    )

    await expect(
      fetchClaudeRateLimits({ authPreparation, allowPtyFallback: false })
    ).resolves.toMatchObject({
      provider: 'claude',
      status: 'error',
      error:
        'Claude usage refresh is waiting for the live Claude terminal to rotate its credentials.'
    })

    expect(fetchViaPty).not.toHaveBeenCalled()
  })

  it('does not start CLI fallback when live Claude owns managed refresh and no token is readable', async () => {
    const configDir = '/Users/test/.claude'
    const authPreparation: ClaudeRuntimeAuthPreparation = {
      configDir,
      envPatch: { CLAUDE_CONFIG_DIR: configDir },
      stripAuthEnv: false,
      managedRefreshDeferredByLivePty: true,
      provenance: 'managed:account-1'
    }

    await expect(fetchClaudeRateLimits({ authPreparation })).resolves.toMatchObject({
      provider: 'claude',
      status: 'error',
      error:
        'Claude usage refresh is waiting for the live Claude terminal to rotate its credentials.',
      usageMetadata: {
        failureKind: 'deferred-by-live-session',
        deferredByLiveClaudeSession: true,
        attemptedSources: []
      }
    })

    expect(fetchViaPty).not.toHaveBeenCalled()
  })

  it('does not start the PTY fallback when disabled for background fetches', async () => {
    const configDir = '/Users/test/.claude'
    const authPreparation: ClaudeRuntimeAuthPreparation = {
      configDir,
      envPatch: { CLAUDE_CONFIG_DIR: configDir },
      stripAuthEnv: false,
      provenance: 'system'
    }
    vi.mocked(readActiveClaudeKeychainCredentialsStrict).mockResolvedValueOnce(
      JSON.stringify({
        claudeAiOauth: {
          accessToken: 'oauth-token',
          refreshToken: 'refresh-token',
          expiresAt: Date.now() + 60_000
        }
      })
    )
    netFetchMock.mockResolvedValueOnce(new Response('temporary failure', { status: 500 }))

    await expect(
      fetchClaudeRateLimits({ authPreparation, allowPtyFallback: false })
    ).resolves.toMatchObject({
      provider: 'claude',
      status: 'error',
      error: 'OAuth API returned 500'
    })

    expect(fetchViaPty).not.toHaveBeenCalled()
  })

  it('does not start the PTY fallback for refresh-only credentials when disabled', async () => {
    const configDir = '/Users/test/.claude'
    const authPreparation: ClaudeRuntimeAuthPreparation = {
      configDir,
      envPatch: { CLAUDE_CONFIG_DIR: configDir },
      stripAuthEnv: false,
      provenance: 'system'
    }
    vi.mocked(readActiveClaudeKeychainCredentialsStrict).mockResolvedValueOnce(
      JSON.stringify({
        claudeAiOauth: {
          refreshToken: 'refresh-token',
          expiresAt: Date.now() - 60_000
        }
      })
    )

    await expect(
      fetchClaudeRateLimits({ authPreparation, allowPtyFallback: false })
    ).resolves.toMatchObject({
      provider: 'claude',
      status: 'error',
      error: 'Claude OAuth access token unavailable'
    })

    expect(fetchViaPty).not.toHaveBeenCalled()
  })

  it('falls back to CLI when OAuth credentials are missing in automatic mode', async () => {
    const authPreparation: ClaudeRuntimeAuthPreparation = {
      configDir: '/Users/test/.claude',
      envPatch: {},
      stripAuthEnv: false,
      provenance: 'system'
    }

    await expect(fetchClaudeRateLimits({ authPreparation })).resolves.toMatchObject({
      provider: 'claude',
      status: 'ok',
      session: { usedPercent: 56 },
      usageMetadata: {
        source: 'cli',
        attemptedSources: ['cli'],
        credentialSource: 'none'
      }
    })

    expect(fetchViaPty).toHaveBeenCalledWith({ authPreparation })
  })

  it('marks CLI plan usage shell results as usage unavailable', async () => {
    const authPreparation: ClaudeRuntimeAuthPreparation = {
      configDir: '/Users/test/.claude',
      envPatch: {},
      stripAuthEnv: false,
      provenance: 'system'
    }
    vi.mocked(fetchViaPty).mockResolvedValueOnce({
      provider: 'claude',
      session: null,
      weekly: null,
      updatedAt: 1,
      error: 'Claude plan usage is unavailable for this Claude CLI session.',
      status: 'error'
    })

    await expect(fetchClaudeRateLimits({ authPreparation })).resolves.toMatchObject({
      provider: 'claude',
      status: 'error',
      error: 'Claude plan usage is unavailable for this Claude CLI session.',
      usageMetadata: {
        source: 'cli',
        attemptedSources: ['cli'],
        failureKind: 'usage-unavailable'
      }
    })
  })

  it('surfaces Keychain read failures as structured usage metadata when CLI fallback is disabled', async () => {
    vi.mocked(readActiveClaudeKeychainCredentials).mockRejectedValueOnce(
      new Error('security timed out after 3000ms')
    )

    await expect(fetchClaudeRateLimits({ allowPtyFallback: false })).resolves.toMatchObject({
      provider: 'claude',
      status: 'error',
      error: 'Claude Keychain credentials unavailable',
      usageMetadata: {
        failureKind: 'keychain-unavailable',
        attemptedSources: [],
        credentialSource: 'none'
      }
    })

    expect(fetchViaPty).not.toHaveBeenCalled()
  })

  it('uses CLI fallback when Keychain is unavailable in automatic mode', async () => {
    const authPreparation: ClaudeRuntimeAuthPreparation = {
      configDir: '/Users/test/.claude',
      envPatch: {},
      stripAuthEnv: false,
      provenance: 'system'
    }
    vi.mocked(readActiveClaudeKeychainCredentials).mockRejectedValueOnce(
      new Error('security timed out after 3000ms')
    )

    await expect(fetchClaudeRateLimits({ authPreparation })).resolves.toMatchObject({
      provider: 'claude',
      status: 'ok',
      session: { usedPercent: 56 },
      usageMetadata: {
        source: 'cli',
        attemptedSources: ['cli'],
        credentialSource: 'none'
      }
    })

    expect(fetchViaPty).toHaveBeenCalledWith({ authPreparation })
  })

  it('does not read inactive managed credentials from unowned auth paths', async () => {
    setPlatform('linux')
    tempDir = mkdtempSync(join(tmpdir(), 'orca-claude-fetcher-'))
    appGetPathMock.mockReturnValue(tempDir)
    const unownedAuthPath = join(tempDir, 'unowned', 'auth')
    mkdirSync(unownedAuthPath, { recursive: true })
    writeFileSync(join(unownedAuthPath, '.orca-managed-claude-auth'), 'account-1\n', 'utf-8')
    writeFileSync(
      join(unownedAuthPath, '.credentials.json'),
      JSON.stringify({
        claudeAiOauth: {
          accessToken: 'unowned-token',
          expiresAt: Date.now() + 60_000
        }
      }),
      'utf-8'
    )

    await expect(
      fetchManagedAccountUsage({ id: 'account-1', managedAuthPath: unownedAuthPath })
    ).resolves.toMatchObject({
      provider: 'claude',
      status: 'error',
      error: 'No credentials'
    })

    expect(netFetchMock).not.toHaveBeenCalled()
    expect(readFileMock).not.toHaveBeenCalled()
  })

  it('supplements inactive managed account OAuth usage with Fable from its usage panel', async () => {
    setPlatform('linux')
    tempDir = mkdtempSync(join(tmpdir(), 'orca-claude-fetcher-'))
    appGetPathMock.mockReturnValue(tempDir)
    const ownedAuthPath = join(tempDir, 'claude-accounts', 'account-1', 'auth')
    mkdirSync(ownedAuthPath, { recursive: true })
    writeFileSync(join(ownedAuthPath, '.orca-managed-claude-auth'), 'account-1\n', 'utf-8')
    const canonicalAuthPath = realpathSync(ownedAuthPath)
    writeFileSync(
      join(ownedAuthPath, '.credentials.json'),
      JSON.stringify({
        claudeAiOauth: {
          accessToken: 'inactive-token',
          expiresAt: Date.now() + 60 * 60_000
        }
      }),
      'utf-8'
    )
    vi.mocked(fetchViaPty).mockResolvedValueOnce({
      provider: 'claude',
      session: null,
      weekly: null,
      fableWeekly: {
        usedPercent: 42,
        windowMinutes: 10080,
        resetsAt: null,
        resetDescription: '2d'
      },
      updatedAt: 1,
      error: null,
      status: 'ok'
    })

    await expect(
      fetchManagedAccountUsage(
        { id: 'account-1', managedAuthPath: ownedAuthPath },
        { allowUsagePanelSupplement: true }
      )
    ).resolves.toMatchObject({
      provider: 'claude',
      status: 'ok',
      session: { usedPercent: 12 },
      weekly: { usedPercent: 34 },
      fableWeekly: { usedPercent: 42, resetDescription: '2d' }
    })
    expect(fetchViaPty).toHaveBeenCalledWith({
      authPreparation: expect.objectContaining({
        configDir: canonicalAuthPath,
        envPatch: { CLAUDE_CONFIG_DIR: canonicalAuthPath },
        provenance: 'managed:account-1:inactive-preview',
        stripAuthEnv: true
      })
    })
  })

  it('stages macOS inactive account credentials in a scoped Keychain for Fable preview', async () => {
    setPlatform('darwin')
    tempDir = mkdtempSync(join(tmpdir(), 'orca-claude-fetcher-'))
    appGetPathMock.mockReturnValue(tempDir)
    const ownedAuthPath = join(tempDir, 'claude-accounts', 'account-1', 'auth')
    const credentialsJson = JSON.stringify({
      claudeAiOauth: {
        accessToken: 'managed-keychain-token',
        expiresAt: Date.now() + 60 * 60_000
      }
    })
    mkdirSync(ownedAuthPath, { recursive: true })
    writeFileSync(join(ownedAuthPath, '.orca-managed-claude-auth'), 'account-1\n', 'utf-8')
    const canonicalAuthPath = realpathSync(ownedAuthPath)
    vi.mocked(readManagedClaudeKeychainCredentials).mockResolvedValueOnce(credentialsJson)
    vi.mocked(fetchViaPty).mockResolvedValueOnce({
      provider: 'claude',
      session: {
        usedPercent: 12,
        windowMinutes: 300,
        resetsAt: null,
        resetDescription: null
      },
      weekly: {
        usedPercent: 34,
        windowMinutes: 10080,
        resetsAt: null,
        resetDescription: null
      },
      fableWeekly: {
        usedPercent: 58,
        windowMinutes: 10080,
        resetsAt: null,
        resetDescription: '3d'
      },
      updatedAt: 1,
      error: null,
      status: 'ok'
    })

    const result = await fetchManagedAccountUsage(
      { id: 'account-1', managedAuthPath: ownedAuthPath },
      { allowUsagePanelSupplement: true }
    )

    expect(result.fableWeekly).toMatchObject({ usedPercent: 58, resetDescription: '3d' })
    expect(writeActiveClaudeKeychainCredentials).toHaveBeenCalledWith(
      credentialsJson,
      canonicalAuthPath
    )
    expect(deleteActiveClaudeKeychainCredentialsStrict).toHaveBeenCalledWith(canonicalAuthPath)
  })

  it('stages refreshed macOS inactive account credentials before Fable preview', async () => {
    setPlatform('darwin')
    tempDir = mkdtempSync(join(tmpdir(), 'orca-claude-fetcher-'))
    appGetPathMock.mockReturnValue(tempDir)
    const ownedAuthPath = join(tempDir, 'claude-accounts', 'account-1', 'auth')
    const staleCredentialsJson = JSON.stringify({
      claudeAiOauth: {
        accessToken: 'stale-access',
        refreshToken: 'stale-refresh',
        expiresAt: Date.now() - 60_000
      }
    })
    mkdirSync(ownedAuthPath, { recursive: true })
    writeFileSync(join(ownedAuthPath, '.orca-managed-claude-auth'), 'account-1\n', 'utf-8')
    vi.mocked(readManagedClaudeKeychainCredentials).mockResolvedValueOnce(staleCredentialsJson)
    netFetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          access_token: 'fresh-access',
          expires_in: 3600,
          refresh_token: 'fresh-refresh'
        }),
        { status: 200 }
      )
    )
    netFetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ five_hour: { utilization: 12 }, seven_day: { utilization: 34 } }),
        {
          status: 200
        }
      )
    )
    vi.mocked(fetchViaPty).mockResolvedValueOnce({
      provider: 'claude',
      session: {
        usedPercent: 12,
        windowMinutes: 300,
        resetsAt: null,
        resetDescription: null
      },
      weekly: {
        usedPercent: 34,
        windowMinutes: 10080,
        resetsAt: null,
        resetDescription: null
      },
      fableWeekly: {
        usedPercent: 58,
        windowMinutes: 10080,
        resetsAt: null,
        resetDescription: '3d'
      },
      updatedAt: 1,
      error: null,
      status: 'ok'
    })

    const result = await fetchManagedAccountUsage(
      { id: 'account-1', managedAuthPath: ownedAuthPath },
      { allowUsagePanelSupplement: true }
    )

    const stagedCredentialsJson = vi.mocked(writeActiveClaudeKeychainCredentials).mock.calls[0]?.[0]
    expect(result.fableWeekly).toMatchObject({ usedPercent: 58, resetDescription: '3d' })
    expect(JSON.parse(stagedCredentialsJson ?? '{}')).toMatchObject({
      claudeAiOauth: {
        accessToken: 'fresh-access',
        refreshToken: 'fresh-refresh'
      }
    })
    expect(writeManagedClaudeKeychainCredentials).toHaveBeenCalledWith(
      'account-1',
      stagedCredentialsJson
    )
  })

  it('does not merge macOS inactive Fable preview when usage windows belong to another account', async () => {
    setPlatform('darwin')
    tempDir = mkdtempSync(join(tmpdir(), 'orca-claude-fetcher-'))
    appGetPathMock.mockReturnValue(tempDir)
    const ownedAuthPath = join(tempDir, 'claude-accounts', 'account-1', 'auth')
    mkdirSync(ownedAuthPath, { recursive: true })
    writeFileSync(join(ownedAuthPath, '.orca-managed-claude-auth'), 'account-1\n', 'utf-8')
    vi.mocked(readManagedClaudeKeychainCredentials).mockResolvedValueOnce(
      JSON.stringify({
        claudeAiOauth: {
          accessToken: 'managed-keychain-token',
          expiresAt: Date.now() + 60_000
        }
      })
    )
    vi.mocked(fetchViaPty).mockResolvedValueOnce({
      provider: 'claude',
      session: {
        usedPercent: 91,
        windowMinutes: 300,
        resetsAt: null,
        resetDescription: null
      },
      weekly: {
        usedPercent: 3,
        windowMinutes: 10080,
        resetsAt: null,
        resetDescription: null
      },
      fableWeekly: {
        usedPercent: 58,
        windowMinutes: 10080,
        resetsAt: null,
        resetDescription: '3d'
      },
      updatedAt: 1,
      error: null,
      status: 'ok'
    })

    const result = await fetchManagedAccountUsage(
      { id: 'account-1', managedAuthPath: ownedAuthPath },
      { allowUsagePanelSupplement: true }
    )

    expect(result.fableWeekly).toBeNull()
  })

  it('refreshes and persists an expiring inactive account before fetching usage', async () => {
    setPlatform('linux')
    tempDir = mkdtempSync(join(tmpdir(), 'orca-claude-fetcher-'))
    appGetPathMock.mockReturnValue(tempDir)
    const ownedAuthPath = join(tempDir, 'claude-accounts', 'account-1', 'auth')
    mkdirSync(ownedAuthPath, { recursive: true })
    writeFileSync(join(ownedAuthPath, '.orca-managed-claude-auth'), 'account-1\n', 'utf-8')
    const credentialsPath = join(ownedAuthPath, '.credentials.json')
    writeFileSync(
      credentialsPath,
      JSON.stringify({
        claudeAiOauth: {
          accessToken: 'stale-access',
          refreshToken: 'stale-refresh',
          expiresAt: Date.now() - 60_000
        }
      }),
      'utf-8'
    )

    // First net.fetch call is the OAuth refresh (token endpoint); second is the
    // usage fetch with the refreshed access token.
    netFetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        access_token: 'fresh-access',
        expires_in: 3600,
        refresh_token: 'fresh-refresh'
      })
    })
    netFetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ five_hour: { utilization: 12 }, seven_day: { utilization: 34 } })
    })

    const result = await fetchManagedAccountUsage({
      id: 'account-1',
      managedAuthPath: ownedAuthPath
    })

    expect(result.status).toBe('ok')
    // Rotated token persisted back to managed storage.
    const persisted = JSON.parse(readFileSync(credentialsPath, 'utf-8'))
    expect(persisted.claudeAiOauth.accessToken).toBe('fresh-access')
    expect(persisted.claudeAiOauth.refreshToken).toBe('fresh-refresh')
    // Usage fetch used the fresh access token.
    const usageCall = netFetchMock.mock.calls.find(([url]) =>
      String(url).includes('/api/oauth/usage')
    )
    expect(usageCall?.[1]?.headers?.Authorization).toBe('Bearer fresh-access')
  })

  it('surfaces token-endpoint Retry-After as an absolute managed retry time', async () => {
    setPlatform('linux')
    tempDir = mkdtempSync(join(tmpdir(), 'orca-claude-fetcher-'))
    appGetPathMock.mockReturnValue(tempDir)
    const ownedAuthPath = join(tempDir, 'claude-accounts', 'account-1', 'auth')
    mkdirSync(ownedAuthPath, { recursive: true })
    writeFileSync(join(ownedAuthPath, '.orca-managed-claude-auth'), 'account-1\n', 'utf-8')
    writeFileSync(
      join(ownedAuthPath, '.credentials.json'),
      JSON.stringify({
        claudeAiOauth: {
          accessToken: 'expiring-access',
          refreshToken: 'synthetic-refresh-credential',
          expiresAt: Date.now() + 60_000
        }
      }),
      'utf-8'
    )
    netFetchMock.mockResolvedValueOnce(
      new Response('', { status: 429, headers: { 'retry-after': '120' } })
    )

    const before = Date.now()
    const result = await fetchManagedAccountUsage({
      id: 'account-1',
      managedAuthPath: ownedAuthPath
    })

    expect(result.error).toBe('Rate limited by the token endpoint')
    expect(result.usageMetadata?.retryAtMs).toBeGreaterThanOrEqual(before + 120_000)
    expect(result.usageMetadata?.retryAtMs).toBeLessThanOrEqual(Date.now() + 120_000)
  })

  it('does not fabricate a managed retry time when token-endpoint Retry-After is absent', async () => {
    setPlatform('linux')
    tempDir = mkdtempSync(join(tmpdir(), 'orca-claude-fetcher-'))
    appGetPathMock.mockReturnValue(tempDir)
    const ownedAuthPath = join(tempDir, 'claude-accounts', 'account-1', 'auth')
    mkdirSync(ownedAuthPath, { recursive: true })
    writeFileSync(join(ownedAuthPath, '.orca-managed-claude-auth'), 'account-1\n', 'utf-8')
    writeFileSync(
      join(ownedAuthPath, '.credentials.json'),
      JSON.stringify({
        claudeAiOauth: {
          accessToken: 'expiring-access',
          refreshToken: 'synthetic-refresh-credential',
          expiresAt: Date.now() + 60_000
        }
      }),
      'utf-8'
    )
    netFetchMock.mockResolvedValueOnce(new Response('', { status: 429 }))

    const result = await fetchManagedAccountUsage({
      id: 'account-1',
      managedAuthPath: ownedAuthPath
    })

    expect(result.error).toBe('Rate limited by the token endpoint')
    expect(result.usageMetadata).toBeUndefined()
  })

  it('reads usage with an expired token a live Claude owns when the endpoint accepts it', async () => {
    setPlatform('linux')
    tempDir = mkdtempSync(join(tmpdir(), 'orca-claude-fetcher-'))
    appGetPathMock.mockReturnValue(tempDir)
    const ownedAuthPath = join(tempDir, 'claude-accounts', 'account-1', 'auth')
    mkdirSync(ownedAuthPath, { recursive: true })
    writeFileSync(join(ownedAuthPath, '.orca-managed-claude-auth'), 'account-1\n', 'utf-8')
    const credentialsPath = join(ownedAuthPath, '.credentials.json')
    const credentialsJson = JSON.stringify({
      claudeAiOauth: {
        accessToken: 'expired-access',
        refreshToken: 'live-refresh',
        expiresAt: Date.now() - 60_000
      }
    })
    writeFileSync(credentialsPath, credentialsJson, 'utf-8')
    // Why: local expiresAt isn't authoritative for /api/oauth/usage — the server decides.
    netFetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ five_hour: { utilization: 12 }, seven_day: { utilization: 34 } })
    })

    const result = await fetchManagedAccountUsage(
      { id: 'account-1', managedAuthPath: ownedAuthPath },
      { allowTokenRotation: false }
    )

    expect(result.status).toBe('ok')
    const usageCall = netFetchMock.mock.calls.find(([url]) =>
      String(url).includes('/api/oauth/usage')
    )
    expect(usageCall?.[1]?.headers?.Authorization).toBe('Bearer expired-access')
    expect(netFetchMock.mock.calls.some(([url]) => String(url).includes('/v1/oauth/token'))).toBe(
      false
    )
    // The live session's single-use refresh token is left untouched.
    expect(readFileSync(credentialsPath, 'utf-8')).toBe(credentialsJson)
  })

  it('defers instead of surfacing an auth error when the endpoint rejects the un-rotated token', async () => {
    setPlatform('linux')
    tempDir = mkdtempSync(join(tmpdir(), 'orca-claude-fetcher-'))
    appGetPathMock.mockReturnValue(tempDir)
    const ownedAuthPath = join(tempDir, 'claude-accounts', 'account-1', 'auth')
    mkdirSync(ownedAuthPath, { recursive: true })
    writeFileSync(join(ownedAuthPath, '.orca-managed-claude-auth'), 'account-1\n', 'utf-8')
    const credentialsPath = join(ownedAuthPath, '.credentials.json')
    const credentialsJson = JSON.stringify({
      claudeAiOauth: {
        accessToken: 'expired-access',
        refreshToken: 'live-refresh',
        expiresAt: Date.now() - 60_000
      }
    })
    writeFileSync(credentialsPath, credentialsJson, 'utf-8')
    netFetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: { message: 'Invalid authentication credentials' } }), {
        status: 401
      })
    )

    const result = await fetchManagedAccountUsage(
      { id: 'account-1', managedAuthPath: ownedAuthPath },
      { allowTokenRotation: false }
    )

    expect(result.status).toBe('error')
    expect(result.usageMetadata?.failureKind).toBe('deferred-by-live-session')
    expect(result.error).not.toMatch(/Invalid authentication/)
    expect(netFetchMock.mock.calls.some(([url]) => String(url).includes('/v1/oauth/token'))).toBe(
      false
    )
    expect(readFileSync(credentialsPath, 'utf-8')).toBe(credentialsJson)
  })

  it('defers when background rotation cannot fingerprint the managed credentials', async () => {
    setPlatform('linux')
    tempDir = mkdtempSync(join(tmpdir(), 'orca-claude-fetcher-'))
    appGetPathMock.mockReturnValue(tempDir)
    const ownedAuthPath = join(tempDir, 'claude-accounts', 'account-1', 'auth')
    mkdirSync(ownedAuthPath, { recursive: true })
    writeFileSync(join(ownedAuthPath, '.orca-managed-claude-auth'), 'account-1\n', 'utf-8')
    writeFileSync(
      join(ownedAuthPath, '.credentials.json'),
      JSON.stringify({
        claudeAiOauth: {
          accessToken: 'expiring-access',
          expiresAt: Date.now() + 60_000
        }
      }),
      'utf-8'
    )
    netFetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: { message: 'Invalid authentication credentials' } }), {
        status: 401
      })
    )

    const result = await fetchManagedAccountUsage({
      id: 'account-1',
      managedAuthPath: ownedAuthPath
    })

    expect(result.status).toBe('error')
    expect(result.usageMetadata?.failureKind).toBe('deferred-by-live-session')
    expect(result.error).not.toBe('No credentials')
    expect(netFetchMock.mock.calls.some(([url]) => String(url).includes('/v1/oauth/token'))).toBe(
      false
    )
  })

  it('defers a blank live-CLI credentials blob instead of reporting no credentials', async () => {
    setPlatform('linux')
    tempDir = mkdtempSync(join(tmpdir(), 'orca-claude-fetcher-'))
    appGetPathMock.mockReturnValue(tempDir)
    const ownedAuthPath = join(tempDir, 'claude-accounts', 'account-1', 'auth')
    mkdirSync(ownedAuthPath, { recursive: true })
    writeFileSync(join(ownedAuthPath, '.orca-managed-claude-auth'), 'account-1\n', 'utf-8')
    // A live CLI that lost a refresh race can leave an empty-token blob behind.
    writeFileSync(
      join(ownedAuthPath, '.credentials.json'),
      JSON.stringify({ claudeAiOauth: { accessToken: '', refreshToken: 'live-refresh' } }),
      'utf-8'
    )

    const result = await fetchManagedAccountUsage(
      { id: 'account-1', managedAuthPath: ownedAuthPath },
      { allowTokenRotation: false }
    )

    expect(result.status).toBe('error')
    expect(result.usageMetadata?.failureKind).toBe('deferred-by-live-session')
    expect(result.error).not.toBe('No credentials')
    expect(netFetchMock).not.toHaveBeenCalled()
  })

  it('never falls back to the legacy keychain identity for a live-pinned account read', async () => {
    setPlatform('darwin')
    const pinnedConfigDir = '/tmp/orca-accounts/account-1/auth'
    // The pinned CLI's scoped item is momentarily blank; the legacy unsuffixed
    // item holds the GLOBAL account's token — a different identity.
    vi.mocked(readActiveClaudeKeychainCredentialsStrict).mockImplementation(async (configDir) =>
      configDir
        ? null
        : JSON.stringify({
            claudeAiOauth: { accessToken: 'other-identity-token', expiresAt: Date.now() + 60_000 }
          })
    )

    const result = await fetchClaudeRateLimits({
      authPreparation: {
        configDir: pinnedConfigDir,
        runtime: 'host',
        wslDistro: null,
        wslLinuxConfigDir: null,
        envPatch: { CLAUDE_CONFIG_DIR: pinnedConfigDir },
        stripAuthEnv: true,
        managedRefreshDeferredByLivePty: true,
        accountScopedConfigDir: true,
        provenance: 'managed:account-1:live-pinned-read'
      }
    })

    expect(result.usageMetadata?.failureKind).toBe('deferred-by-live-session')
    // Another account's usage must never render on this account's meter.
    expect(
      netFetchMock.mock.calls.some(
        ([, init]) =>
          (init as RequestInit | undefined)?.headers?.['Authorization' as never] ===
          'Bearer other-identity-token'
      )
    ).toBe(false)
    expect(fetchViaPty).not.toHaveBeenCalled()
  })

  it('skips rotation when a Claude launch reservation races the usage read', async () => {
    setPlatform('linux')
    tempDir = mkdtempSync(join(tmpdir(), 'orca-claude-fetcher-'))
    appGetPathMock.mockReturnValue(tempDir)
    const ownedAuthPath = join(tempDir, 'claude-accounts', 'account-1', 'auth')
    mkdirSync(ownedAuthPath, { recursive: true })
    writeFileSync(join(ownedAuthPath, '.orca-managed-claude-auth'), 'account-1\n', 'utf-8')
    const credentialsPath = join(ownedAuthPath, '.credentials.json')
    const credentialsJson = JSON.stringify({
      claudeAiOauth: {
        accessToken: 'expiring-access',
        refreshToken: 'single-use-refresh',
        expiresAt: Date.now() + 60_000
      }
    })
    writeFileSync(credentialsPath, credentialsJson, 'utf-8')
    netFetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ five_hour: { utilization: 12 }, seven_day: { utilization: 34 } })
    })
    // A worktree launch is preparing this account; rotating now would hand the
    // spawning CLI a pre-rotation refresh token that dies on first refresh.
    const reservationId = reserveInjectedClaudeAccountLaunch('account-1')

    try {
      const result = await fetchManagedAccountUsage({
        id: 'account-1',
        managedAuthPath: ownedAuthPath
      })

      expect(result.status).toBe('ok')
      expect(netFetchMock.mock.calls.some(([url]) => String(url).includes('/v1/oauth/token'))).toBe(
        false
      )
      expect(readFileSync(credentialsPath, 'utf-8')).toBe(credentialsJson)
    } finally {
      releaseInjectedClaudeAccountLaunch(reservationId)
    }
  })

  it('adopts the live CLI scoped keychain rotation instead of rotating the managed copy (macOS)', async () => {
    setPlatform('darwin')
    tempDir = mkdtempSync(join(tmpdir(), 'orca-claude-fetcher-'))
    appGetPathMock.mockReturnValue(tempDir)
    const ownedAuthPath = join(tempDir, 'claude-accounts', 'account-1', 'auth')
    mkdirSync(ownedAuthPath, { recursive: true })
    writeFileSync(join(ownedAuthPath, '.orca-managed-claude-auth'), 'account-1\n', 'utf-8')
    // Orca's managed copy is stale — the live CLI rotated the scoped Keychain item.
    vi.mocked(readManagedClaudeKeychainCredentials).mockResolvedValueOnce(
      JSON.stringify({
        claudeAiOauth: {
          accessToken: 'stale-managed-access',
          refreshToken: 'stale-managed-refresh',
          expiresAt: Date.now() - 60_000
        }
      })
    )
    // Why: the managed-location resolver may realpath the dir, so match by suffix.
    vi.mocked(readActiveClaudeKeychainCredentialsStrict).mockImplementation(async (configDir) =>
      configDir?.endsWith(join('account-1', 'auth'))
        ? JSON.stringify({
            claudeAiOauth: {
              accessToken: 'live-cli-access',
              refreshToken: 'live-cli-refresh',
              expiresAt: Date.now() + 60 * 60_000
            }
          })
        : null
    )
    netFetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ five_hour: { utilization: 12 }, seven_day: { utilization: 34 } })
    })

    const result = await fetchManagedAccountUsage(
      { id: 'account-1', managedAuthPath: ownedAuthPath },
      { allowTokenRotation: false }
    )

    expect(result.status).toBe('ok')
    const usageCall = netFetchMock.mock.calls.find(([url]) =>
      String(url).includes('/api/oauth/usage')
    )
    expect(usageCall?.[1]?.headers?.Authorization).toBe('Bearer live-cli-access')
    expect(netFetchMock.mock.calls.some(([url]) => String(url).includes('/v1/oauth/token'))).toBe(
      false
    )
    // Read-only: the adoption never writes back to managed or runtime storage.
    expect(writeManagedClaudeKeychainCredentials).not.toHaveBeenCalled()
    expect(writeActiveClaudeKeychainCredentials).not.toHaveBeenCalled()
  })

  it('reads with a still-valid token inside the refresh buffer without rotating it', async () => {
    setPlatform('linux')
    tempDir = mkdtempSync(join(tmpdir(), 'orca-claude-fetcher-'))
    appGetPathMock.mockReturnValue(tempDir)
    const ownedAuthPath = join(tempDir, 'claude-accounts', 'account-1', 'auth')
    mkdirSync(ownedAuthPath, { recursive: true })
    writeFileSync(join(ownedAuthPath, '.orca-managed-claude-auth'), 'account-1\n', 'utf-8')
    const credentialsPath = join(ownedAuthPath, '.credentials.json')
    const credentialsJson = JSON.stringify({
      claudeAiOauth: {
        accessToken: 'buffered-access',
        refreshToken: 'live-refresh',
        // Inside the 5-minute refresh buffer, but not yet expired.
        expiresAt: Date.now() + 60_000
      }
    })
    writeFileSync(credentialsPath, credentialsJson, 'utf-8')
    netFetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ five_hour: { utilization: 12 }, seven_day: { utilization: 34 } })
    })

    const result = await fetchManagedAccountUsage(
      { id: 'account-1', managedAuthPath: ownedAuthPath },
      { allowTokenRotation: false, allowUsagePanelSupplement: true }
    )

    expect(result.status).toBe('ok')
    const usageCall = netFetchMock.mock.calls.find(([url]) =>
      String(url).includes('/api/oauth/usage')
    )
    expect(usageCall?.[1]?.headers?.Authorization).toBe('Bearer buffered-access')
    // No token-endpoint rotation and no second CLI that would rotate it either.
    expect(netFetchMock.mock.calls.some(([url]) => String(url).includes('/v1/oauth/token'))).toBe(
      false
    )
    expect(fetchViaPty).not.toHaveBeenCalled()
    expect(readFileSync(credentialsPath, 'utf-8')).toBe(credentialsJson)
  })

  it('yields rotation to a Claude launch that reserved the account mid-read', async () => {
    setPlatform('linux')
    tempDir = mkdtempSync(join(tmpdir(), 'orca-claude-fetcher-'))
    appGetPathMock.mockReturnValue(tempDir)
    const ownedAuthPath = join(tempDir, 'claude-accounts', 'account-1', 'auth')
    mkdirSync(ownedAuthPath, { recursive: true })
    writeFileSync(join(ownedAuthPath, '.orca-managed-claude-auth'), 'account-1\n', 'utf-8')
    const credentialsPath = join(ownedAuthPath, '.credentials.json')
    const credentialsJson = JSON.stringify({
      claudeAiOauth: {
        accessToken: 'expiring-access',
        refreshToken: 'launch-owned-refresh',
        expiresAt: Date.now() + 60_000
      }
    })
    writeFileSync(credentialsPath, credentialsJson, 'utf-8')
    netFetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ five_hour: { utilization: 12 }, seven_day: { utilization: 34 } })
    })
    // The caller's liveness check passed, but a launch reserves the account before rotation.
    const reservationId = reserveInjectedClaudeAccountLaunch('account-1')

    try {
      const result = await fetchManagedAccountUsage(
        { id: 'account-1', managedAuthPath: ownedAuthPath },
        { allowTokenRotation: true, allowUsagePanelSupplement: true }
      )

      expect(result.status).toBe('ok')
      // The atomic gate refused rotation, the read proceeded with the stored token,
      // and no supplement CLI ran on the reserved credentials.
      expect(netFetchMock.mock.calls.some(([url]) => String(url).includes('/v1/oauth/token'))).toBe(
        false
      )
      expect(fetchViaPty).not.toHaveBeenCalled()
      expect(readFileSync(credentialsPath, 'utf-8')).toBe(credentialsJson)
    } finally {
      releaseInjectedClaudeAccountLaunch(reservationId)
    }
  })

  it('defers when rotation yielded to a launch and the endpoint rejects the token', async () => {
    setPlatform('linux')
    tempDir = mkdtempSync(join(tmpdir(), 'orca-claude-fetcher-'))
    appGetPathMock.mockReturnValue(tempDir)
    const ownedAuthPath = join(tempDir, 'claude-accounts', 'account-1', 'auth')
    mkdirSync(ownedAuthPath, { recursive: true })
    writeFileSync(join(ownedAuthPath, '.orca-managed-claude-auth'), 'account-1\n', 'utf-8')
    writeFileSync(
      join(ownedAuthPath, '.credentials.json'),
      JSON.stringify({
        claudeAiOauth: {
          accessToken: 'expired-access',
          refreshToken: 'launch-owned-refresh',
          expiresAt: Date.now() - 60_000
        }
      }),
      'utf-8'
    )
    netFetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: { message: 'Invalid authentication credentials' } }), {
        status: 401
      })
    )
    const reservationId = reserveInjectedClaudeAccountLaunch('account-1')

    try {
      const result = await fetchManagedAccountUsage(
        { id: 'account-1', managedAuthPath: ownedAuthPath },
        { allowTokenRotation: true }
      )

      expect(result.status).toBe('error')
      expect(result.usageMetadata?.failureKind).toBe('deferred-by-live-session')
      expect(netFetchMock.mock.calls.some(([url]) => String(url).includes('/v1/oauth/token'))).toBe(
        false
      )
    } finally {
      releaseInjectedClaudeAccountLaunch(reservationId)
    }
  })
})
