import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  ClaudeOauthRefreshCooldownStore,
  DEFAULT_CLAUDE_OAUTH_REFRESH_COOLDOWN_MS,
  MAX_CLAUDE_OAUTH_REFRESH_COOLDOWN_MS,
  MIN_CLAUDE_OAUTH_REFRESH_COOLDOWN_MS
} from './claude-oauth-refresh-cooldown'

describe('ClaudeOauthRefreshCooldownStore', () => {
  const NOW = 1_000_000_000
  let dir: string
  let filePath: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'claude-oauth-cooldown-'))
    filePath = join(dir, 'oauth-refresh-cooldowns.json')
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('applies the bounded default when the server sent no Retry-After', () => {
    const store = new ClaudeOauthRefreshCooldownStore(filePath)

    const untilMs = store.beginCooldown('account-1', {}, NOW)

    expect(untilMs).toBe(NOW + DEFAULT_CLAUDE_OAUTH_REFRESH_COOLDOWN_MS)
    expect(store.getRetryAtMs('account-1', NOW)).toBe(untilMs)
    expect(store.getRetryAtMs('account-1', untilMs - 1)).toBe(untilMs)
    expect(store.getRetryAtMs('account-1', untilMs)).toBeNull()
  })

  it('honors Retry-After seconds when supplied', () => {
    const store = new ClaudeOauthRefreshCooldownStore(filePath)

    const untilMs = store.beginCooldown('account-1', { retryAfterSeconds: 900 }, NOW)

    expect(untilMs).toBe(NOW + 900 * 1000)
  })

  it('honors an absolute retryAtMs when supplied', () => {
    const store = new ClaudeOauthRefreshCooldownStore(filePath)

    const untilMs = store.beginCooldown('account-1', { retryAtMs: NOW + 20 * 60 * 1000 }, NOW)

    expect(untilMs).toBe(NOW + 20 * 60 * 1000)
  })

  it('clamps a huge Retry-After to the cap and a tiny one to the floor', () => {
    const store = new ClaudeOauthRefreshCooldownStore(filePath)

    expect(store.beginCooldown('account-1', { retryAfterSeconds: 24 * 60 * 60 }, NOW)).toBe(
      NOW + MAX_CLAUDE_OAUTH_REFRESH_COOLDOWN_MS
    )
    expect(store.beginCooldown('account-2', { retryAfterSeconds: 1 }, NOW)).toBe(
      NOW + MIN_CLAUDE_OAUTH_REFRESH_COOLDOWN_MS
    )
  })

  it('tracks cooldowns per account', () => {
    const store = new ClaudeOauthRefreshCooldownStore(filePath)

    store.beginCooldown('account-1', {}, NOW)

    expect(store.isCoolingDown('account-1', NOW)).toBe(true)
    expect(store.isCoolingDown('account-2', NOW)).toBe(false)
  })

  it('clears a cooldown after a successful read', () => {
    const store = new ClaudeOauthRefreshCooldownStore(filePath)
    store.beginCooldown('account-1', {}, NOW)

    store.clear('account-1')

    expect(store.getRetryAtMs('account-1', NOW)).toBeNull()
  })

  it('survives a restart: a new instance reads the same file', () => {
    const store = new ClaudeOauthRefreshCooldownStore(filePath)
    const untilMs = store.beginCooldown('account-1', { retryAfterSeconds: 1800 }, NOW)

    const reloaded = new ClaudeOauthRefreshCooldownStore(filePath)

    expect(reloaded.getRetryAtMs('account-1', NOW)).toBe(untilMs)
    expect(reloaded.getRetryAtMs('account-2', NOW)).toBeNull()
  })

  it('treats an absurd persisted end time as expired rather than freezing the account', () => {
    const store = new ClaudeOauthRefreshCooldownStore(filePath)
    store.beginCooldown('account-1', {}, NOW)

    // A later read at a wall clock far in the past (clock jumped backwards).
    expect(store.getRetryAtMs('account-1', NOW - 2 * MAX_CLAUDE_OAUTH_REFRESH_COOLDOWN_MS)).toBe(
      null
    )
  })

  it('degrades a corrupt file to no cooldowns', () => {
    writeFileSync(filePath, 'not json', 'utf-8')
    const store = new ClaudeOauthRefreshCooldownStore(filePath)

    expect(store.getRetryAtMs('account-1', NOW)).toBeNull()
    expect(store.beginCooldown('account-1', {}, NOW)).toBe(
      NOW + DEFAULT_CLAUDE_OAUTH_REFRESH_COOLDOWN_MS
    )
  })

  it('works in memory when no file path is available', () => {
    const store = new ClaudeOauthRefreshCooldownStore(null)

    const untilMs = store.beginCooldown('account-1', {}, NOW)

    expect(store.getRetryAtMs('account-1', NOW)).toBe(untilMs)
  })
})
