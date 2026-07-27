import { randomUUID } from 'node:crypto'
import { mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ClaudeRefreshChainFingerprint } from './claude-refresh-chain-fingerprint'
import {
  claudeRefreshClaimPath,
  claudeRefreshClaimsPath,
  claudeRefreshInstancePath,
  claudeRefreshInstancesPath,
  removeClaudeRefreshClaim,
  claudeRefreshRotationLockPath,
  claudeRefreshRotationsPath,
  releaseClaudeRefreshRotationLock,
  renewClaudeRefreshRotationLock,
  touchClaudeRefreshRotationLock
} from './claude-refresh-chain-lease-paths'
import {
  isNodeError,
  isProcessAlive,
  readClaudeRefreshChainLeaseRecord,
  type ClaudeRefreshChainLeaseRecord
} from './claude-refresh-chain-lease-record'
import {
  isClaudeRefreshChainClaimOwnerValid,
  isClaudeRefreshChainClaimProvablyDead,
  type ClaudeRefreshChainClaimLivenessContext
} from './claude-refresh-chain-claim-liveness'

// Why: twenty missed renewals tolerate long event-loop stalls while a crash blocks rotation for at most ten minutes.
export const CLAUDE_REFRESH_CHAIN_LEASE_TTL_MS = 10 * 60 * 1000
// Why: a 30-second heartbeat keeps healthy claims far from the bounded stale threshold.
export const CLAUDE_REFRESH_CHAIN_RENEW_INTERVAL_MS = 30 * 1000

export type ClaudeRefreshChainLeaseStoreOptions = {
  rootPath: string
  processId?: number
  instanceId?: string
  instanceStartedAt?: number
  now?: () => number
  processIsAlive?: (processId: number) => boolean | null
}

export type ClaudeRefreshChainRotationLease = { release(): void }

export class ClaudeRefreshChainLeaseStore {
  private readonly processId: number
  private readonly instanceId: string
  private readonly instanceStartedAt: number
  private readonly now: () => number
  private readonly processIsAlive: (processId: number) => boolean | null
  private readonly claimIds = new Map<string, ClaudeRefreshChainLeaseRecord>()
  private renewTimer: NodeJS.Timeout | null = null
  private warnedClaimFailure = false
  private renewalObserver: (() => void) | null = null

  constructor(private readonly options: ClaudeRefreshChainLeaseStoreOptions) {
    this.processId = options.processId ?? process.pid
    this.instanceId = options.instanceId ?? randomUUID()
    this.instanceStartedAt =
      options.instanceStartedAt ?? Math.round(Date.now() - process.uptime() * 1000)
    this.now = options.now ?? Date.now
    this.processIsAlive = options.processIsAlive ?? isProcessAlive
  }

  registerClaim(ownerId: string): void {
    const record = this.createRecord(null)
    this.claimIds.set(ownerId, record)
    try {
      this.initializeClaimState()
      this.writeClaim(ownerId, record, true)
      this.startRenewal()
    } catch {
      this.warnClaimFailureOnce()
    }
  }

  setClaimFingerprint(ownerId: string, fingerprint: ClaudeRefreshChainFingerprint): void {
    const current = this.claimIds.get(ownerId)
    if (!current) {
      return
    }
    const updated = {
      ...current,
      fingerprint,
      expiresAt: this.now() + CLAUDE_REFRESH_CHAIN_LEASE_TTL_MS
    }
    this.claimIds.set(ownerId, updated)
    try {
      this.writeClaim(ownerId, updated, false)
    } catch {
      this.warnClaimFailureOnce()
    }
  }

  transferClaim(fromOwnerId: string, toOwnerId: string): void {
    const record = this.claimIds.get(fromOwnerId)
    if (!record) {
      this.registerClaim(toOwnerId)
      return
    }
    this.claimIds.delete(fromOwnerId)
    this.claimIds.set(toOwnerId, record)
    try {
      this.writeClaim(toOwnerId, record, true)
      this.removeClaimFile(fromOwnerId)
    } catch {
      this.warnClaimFailureOnce()
    }
  }

  releaseClaim(ownerId: string): void {
    this.claimIds.delete(ownerId)
    this.removeClaimFile(ownerId)
    if (this.claimIds.size === 0 && this.renewTimer) {
      clearInterval(this.renewTimer)
      this.renewTimer = null
    }
  }

  tryAcquireRotation(
    fingerprint: ClaudeRefreshChainFingerprint
  ): ClaudeRefreshChainRotationLease | null {
    try {
      this.ensureDirectories()
      this.sweepDeadClaims()
      const lockPath = claudeRefreshRotationLockPath(this.options.rootPath, fingerprint)
      if (!this.acquireLockDirectory(lockPath)) {
        return null
      }
      if (this.hasBlockingClaim(fingerprint)) {
        rmSync(lockPath, { recursive: true, force: true })
        return null
      }
      const timer = setInterval(() => {
        renewClaudeRefreshRotationLock(lockPath, this.instanceId, this.now())
      }, CLAUDE_REFRESH_CHAIN_RENEW_INTERVAL_MS)
      timer.unref()
      let released = false
      return {
        release: () => {
          if (released) {
            return
          }
          released = true
          clearInterval(timer)
          releaseClaudeRefreshRotationLock(lockPath, this.instanceId)
        }
      }
    } catch {
      return null
    }
  }

  private initializeClaimState(): void {
    this.ensureDirectories()
    this.writeInstanceRecord()
    this.sweepDeadClaims()
  }

  private ensureDirectories(): void {
    mkdirSync(claudeRefreshClaimsPath(this.options.rootPath), { recursive: true, mode: 0o700 })
    mkdirSync(claudeRefreshInstancesPath(this.options.rootPath), { recursive: true, mode: 0o700 })
    mkdirSync(claudeRefreshRotationsPath(this.options.rootPath), { recursive: true, mode: 0o700 })
  }

  private createRecord(
    fingerprint: ClaudeRefreshChainFingerprint | null
  ): ClaudeRefreshChainLeaseRecord {
    return {
      version: 1,
      processId: this.processId,
      instanceId: this.instanceId,
      instanceStartedAt: this.instanceStartedAt,
      expiresAt: this.now() + CLAUDE_REFRESH_CHAIN_LEASE_TTL_MS,
      fingerprint
    }
  }

  private startRenewal(): void {
    if (this.renewTimer) {
      return
    }
    this.renewTimer = setInterval(() => this.renewClaims(), CLAUDE_REFRESH_CHAIN_RENEW_INTERVAL_MS)
    this.renewTimer.unref()
  }

  // Why an observer instead of resolving here: the store knows nothing about accounts, and the
  // claim's chain has to be re-read on every heartbeat — a fingerprint frozen at registration
  // stops matching as soon as the live CLI rotates its own token, silently unprotecting it.
  setRenewalObserver(observer: (() => void) | null): void {
    this.renewalObserver = observer
  }

  private renewClaims(): void {
    try {
      this.writeInstanceRecord()
    } catch {
      this.warnClaimFailureOnce()
    }
    for (const [ownerId, record] of this.claimIds) {
      const renewed = { ...record, expiresAt: this.now() + CLAUDE_REFRESH_CHAIN_LEASE_TTL_MS }
      this.claimIds.set(ownerId, renewed)
      try {
        this.writeClaim(ownerId, renewed, false)
      } catch {
        this.warnClaimFailureOnce()
      }
    }
    try {
      this.renewalObserver?.()
    } catch {
      this.warnClaimFailureOnce()
    }
  }

  private writeClaim(
    ownerId: string,
    record: ClaudeRefreshChainLeaseRecord,
    exclusive: boolean
  ): void {
    writeFileSync(claudeRefreshClaimPath(this.options.rootPath, ownerId), JSON.stringify(record), {
      encoding: 'utf8',
      flag: exclusive ? 'wx' : 'w',
      mode: 0o600
    })
  }

  private writeInstanceRecord(): void {
    const record = this.createRecord(null)
    writeFileSync(
      claudeRefreshInstancePath(this.options.rootPath, this.processId),
      JSON.stringify(record),
      {
        encoding: 'utf8',
        flag: 'w',
        mode: 0o600
      }
    )
  }

  private sweepDeadClaims(): void {
    for (const name of readdirSync(claudeRefreshClaimsPath(this.options.rootPath))) {
      const path = join(claudeRefreshClaimsPath(this.options.rootPath), name)
      const record = readClaudeRefreshChainLeaseRecord(path)
      if (record && this.isProvablyDead(record)) {
        rmSync(path, { force: true })
      }
    }
  }

  private hasBlockingClaim(fingerprint: ClaudeRefreshChainFingerprint): boolean {
    for (const name of readdirSync(claudeRefreshClaimsPath(this.options.rootPath))) {
      const record = readClaudeRefreshChainLeaseRecord(
        join(claudeRefreshClaimsPath(this.options.rootPath), name)
      )
      if (!record || !this.isRecordOwnerValid(record)) {
        return true
      }
      if (record.fingerprint === null || record.fingerprint === fingerprint) {
        return true
      }
    }
    return false
  }

  private get livenessContext(): ClaudeRefreshChainClaimLivenessContext {
    return { rootPath: this.options.rootPath, now: this.now, processIsAlive: this.processIsAlive }
  }

  private isProvablyDead(record: ClaudeRefreshChainLeaseRecord): boolean {
    return isClaudeRefreshChainClaimProvablyDead(record, this.livenessContext)
  }

  private isRecordOwnerValid(record: ClaudeRefreshChainLeaseRecord): boolean {
    return isClaudeRefreshChainClaimOwnerValid(record, this.livenessContext)
  }

  private acquireLockDirectory(lockPath: string): boolean {
    try {
      mkdirSync(lockPath, { mode: 0o700 })
      touchClaudeRefreshRotationLock(lockPath, this.instanceId, this.now())
      return true
    } catch (error) {
      if (!isNodeError(error) || error.code !== 'EEXIST') {
        throw error
      }
    }
    const stat = statSync(lockPath)
    if (stat.mtimeMs + CLAUDE_REFRESH_CHAIN_LEASE_TTL_MS > this.now()) {
      return false
    }
    rmSync(lockPath, { recursive: true, force: true })
    try {
      mkdirSync(lockPath, { mode: 0o700 })
      touchClaudeRefreshRotationLock(lockPath, this.instanceId, this.now())
      return true
    } catch (error) {
      if (isNodeError(error) && error.code === 'EEXIST') {
        return false
      }
      throw error
    }
  }

  private removeClaimFile(ownerId: string): void {
    removeClaudeRefreshClaim(this.options.rootPath, ownerId)
  }

  private warnClaimFailureOnce(): void {
    if (this.warnedClaimFailure) {
      return
    }
    this.warnedClaimFailure = true
    console.warn('[claude-refresh-chain] live session started without a machine-wide claim')
  }
}

function defaultLeaseRoot(): string {
  if (process.env.VITEST === 'true') {
    return join(tmpdir(), 'orca-tests', `claude-refresh-chain-${process.pid}`)
  }
  return join(homedir(), '.orca', 'claude-refresh-chain-leases')
}

export const claudeRefreshChainLeaseStore = new ClaudeRefreshChainLeaseStore({
  rootPath: defaultLeaseRoot()
})
