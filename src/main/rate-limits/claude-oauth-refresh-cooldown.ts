import { app } from 'electron'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

// Why: matches the endpoint's observed throttle windows; long enough to let a
// genuinely-needed CLI refresh win the budget back, short enough to self-heal.
export const DEFAULT_CLAUDE_OAUTH_REFRESH_COOLDOWN_MS = 10 * 60 * 1000
// Why: a tiny Retry-After would re-enter the storm on the next poll tick.
export const MIN_CLAUDE_OAUTH_REFRESH_COOLDOWN_MS = 30 * 1000
// Why: bounds a bogus Retry-After or a clock jump so an account can't stay
// frozen for hours on bad data.
export const MAX_CLAUDE_OAUTH_REFRESH_COOLDOWN_MS = 60 * 60 * 1000

type PersistedClaudeOauthRefreshCooldowns = {
  version: number
  cooldownUntilMsByAccountId: Record<string, number>
}

export type ClaudeOauthRefreshCooldownInput = {
  /** Seconds from the token endpoint's Retry-After header, when it sent one. */
  retryAfterSeconds?: number | null
  /** Absolute unix-ms retry time, e.g. an upstream usageMetadata.retryAtMs. */
  retryAtMs?: number | null
}

/**
 * Per-account cooldown on Claude OAuth token rotation. Once the token endpoint
 * returns 429 for an account, every further refresh attempt keeps that account
 * throttled — so the account's rotation is paused until the server's Retry-After
 * (bounded default when absent). Persisted so an app restart doesn't restart
 * the refresh storm.
 */
export class ClaudeOauthRefreshCooldownStore {
  private cooldownUntilMsByAccountId: Map<string, number> | null = null
  private readonly hasFilePathOverride: boolean
  private readonly filePathOverride: string | null
  private resolvedFilePath: string | null | undefined

  /** `filePath: null` keeps the store in memory only; omit it for the default
   *  location under Orca's Claude auth runtime metadata directory. */
  constructor(filePath?: string | null) {
    this.hasFilePathOverride = filePath !== undefined
    this.filePathOverride = filePath ?? null
  }

  /** Unix-ms time before which this account's token must not be refreshed, or
   *  null when the account is not cooling down. */
  getRetryAtMs(accountId: string, now: number = Date.now()): number | null {
    const cooldowns = this.getCooldowns()
    const untilMs = cooldowns.get(accountId)
    if (untilMs === undefined) {
      return null
    }
    // Why: an entry further out than the cap means a clock jump or corrupted
    // data — treat it as expired rather than freezing the account.
    if (untilMs <= now || untilMs - now > MAX_CLAUDE_OAUTH_REFRESH_COOLDOWN_MS) {
      cooldowns.delete(accountId)
      this.persist()
      return null
    }
    return untilMs
  }

  isCoolingDown(accountId: string, now: number = Date.now()): boolean {
    return this.getRetryAtMs(accountId, now) !== null
  }

  /** Starts (or restarts) the account's cooldown and returns its end time. */
  beginCooldown(
    accountId: string,
    input: ClaudeOauthRefreshCooldownInput = {},
    now: number = Date.now()
  ): number {
    const requestedMs = this.resolveRequestedCooldownMs(input, now)
    const durationMs = Math.min(
      MAX_CLAUDE_OAUTH_REFRESH_COOLDOWN_MS,
      Math.max(MIN_CLAUDE_OAUTH_REFRESH_COOLDOWN_MS, requestedMs)
    )
    const untilMs = now + durationMs
    this.getCooldowns().set(accountId, untilMs)
    this.persist()
    return untilMs
  }

  /** Drops the account's cooldown (a successful read proves rotation works again). */
  clear(accountId: string): void {
    if (this.getCooldowns().delete(accountId)) {
      this.persist()
    }
  }

  private resolveRequestedCooldownMs(input: ClaudeOauthRefreshCooldownInput, now: number): number {
    if (typeof input.retryAtMs === 'number' && Number.isFinite(input.retryAtMs)) {
      return input.retryAtMs - now
    }
    if (typeof input.retryAfterSeconds === 'number' && Number.isFinite(input.retryAfterSeconds)) {
      return input.retryAfterSeconds * 1000
    }
    return DEFAULT_CLAUDE_OAUTH_REFRESH_COOLDOWN_MS
  }

  private getCooldowns(): Map<string, number> {
    if (!this.cooldownUntilMsByAccountId) {
      this.cooldownUntilMsByAccountId = this.load()
    }
    return this.cooldownUntilMsByAccountId
  }

  private getFilePath(): string | null {
    if (this.resolvedFilePath !== undefined) {
      return this.resolvedFilePath
    }
    if (this.hasFilePathOverride) {
      this.resolvedFilePath = this.filePathOverride
      return this.resolvedFilePath
    }
    try {
      // Why: lives beside system-default-auth.json — the directory that already
      // holds Orca's Claude auth runtime metadata.
      this.resolvedFilePath = join(
        app.getPath('userData'),
        'claude-runtime-auth',
        'oauth-refresh-cooldowns.json'
      )
    } catch {
      // Unit tests / pre-app-ready: cooldowns still hold for this process.
      this.resolvedFilePath = null
    }
    return this.resolvedFilePath
  }

  private load(): Map<string, number> {
    const filePath = this.getFilePath()
    const cooldowns = new Map<string, number>()
    if (!filePath) {
      return cooldowns
    }
    try {
      if (!existsSync(filePath)) {
        return cooldowns
      }
      const parsed = JSON.parse(
        readFileSync(filePath, 'utf-8')
      ) as Partial<PersistedClaudeOauthRefreshCooldowns> | null
      const entries = parsed?.cooldownUntilMsByAccountId
      if (entries && typeof entries === 'object') {
        for (const [accountId, untilMs] of Object.entries(entries)) {
          if (typeof untilMs === 'number' && Number.isFinite(untilMs)) {
            cooldowns.set(accountId, untilMs)
          }
        }
      }
      return cooldowns
    } catch {
      // A corrupt metadata file degrades to "no cooldowns" — never blocks reads.
      return cooldowns
    }
  }

  private persist(): void {
    const filePath = this.getFilePath()
    if (!filePath) {
      return
    }
    try {
      const dir = dirname(filePath)
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true })
      }
      const cooldownUntilMsByAccountId: Record<string, number> = {}
      for (const [accountId, untilMs] of this.getCooldowns()) {
        cooldownUntilMsByAccountId[accountId] = untilMs
      }
      const payload: PersistedClaudeOauthRefreshCooldowns = {
        version: 1,
        cooldownUntilMsByAccountId
      }
      // Why: temp-file + rename so a crash mid-write can't leave a truncated file.
      const tmpFile = `${filePath}.${process.pid}.tmp`
      writeFileSync(tmpFile, JSON.stringify(payload), 'utf-8')
      renameSync(tmpFile, filePath)
    } catch (error) {
      console.warn('[claude-rate-limits] failed to persist oauth refresh cooldowns:', error)
    }
  }
}
