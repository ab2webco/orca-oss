import { readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { ClaudeRefreshChainFingerprint } from './claude-refresh-chain-fingerprint'

export function claudeRefreshClaimsPath(rootPath: string): string {
  return join(rootPath, 'claims')
}

export function claudeRefreshInstancesPath(rootPath: string): string {
  return join(rootPath, 'instances')
}

export function claudeRefreshRotationsPath(rootPath: string): string {
  return join(rootPath, 'rotations')
}

export function claudeRefreshClaimPath(rootPath: string, ownerId: string): string {
  return join(claudeRefreshClaimsPath(rootPath), `${ownerId}.json`)
}

export function claudeRefreshInstancePath(rootPath: string, processId: number): string {
  return join(claudeRefreshInstancesPath(rootPath), `${processId}.json`)
}

export function claudeRefreshRotationLockPath(
  rootPath: string,
  fingerprint: ClaudeRefreshChainFingerprint
): string {
  return join(claudeRefreshRotationsPath(rootPath), `${fingerprint}.lock`)
}

export function removeClaudeRefreshClaim(rootPath: string, ownerId: string): void {
  try {
    rmSync(claudeRefreshClaimPath(rootPath, ownerId), { force: true })
  } catch {
    // Claim expiry preserves safety when immediate cleanup is unavailable.
  }
}

export function touchClaudeRefreshRotationLock(
  lockPath: string,
  instanceId: string,
  nowMs: number
): void {
  writeFileSync(join(lockPath, 'owner'), instanceId, {
    encoding: 'utf8',
    flag: 'w',
    mode: 0o600
  })
  const now = new Date(nowMs)
  utimesSync(lockPath, now, now)
}

export function claudeRefreshRotationLockOwnedBy(lockPath: string, instanceId: string): boolean {
  try {
    return readFileSync(join(lockPath, 'owner'), 'utf8') === instanceId
  } catch {
    return false
  }
}

export function renewClaudeRefreshRotationLock(
  lockPath: string,
  instanceId: string,
  nowMs: number
): void {
  if (claudeRefreshRotationLockOwnedBy(lockPath, instanceId)) {
    touchClaudeRefreshRotationLock(lockPath, instanceId, nowMs)
  }
}

export function releaseClaudeRefreshRotationLock(lockPath: string, instanceId: string): void {
  if (claudeRefreshRotationLockOwnedBy(lockPath, instanceId)) {
    rmSync(lockPath, { recursive: true, force: true })
  }
}
