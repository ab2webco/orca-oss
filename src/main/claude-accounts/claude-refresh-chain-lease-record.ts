import { readFileSync } from 'node:fs'
import type { ClaudeRefreshChainFingerprint } from './claude-refresh-chain-fingerprint'
import type { ClaudeRefreshChainIdentityKey } from './claude-refresh-chain-identity'

export type ClaudeRefreshChainLeaseRecord = {
  version: 1
  processId: number
  instanceId: string
  instanceStartedAt: number
  expiresAt: number
  fingerprint: ClaudeRefreshChainFingerprint | null
  // Why optional rather than nullable: an older instance writes the record without this field at
  // all, and reading that absence as "unresolved" would let it block every rotation here.
  identityKey?: ClaudeRefreshChainIdentityKey | null
}

export function readClaudeRefreshChainLeaseRecord(
  path: string
): ClaudeRefreshChainLeaseRecord | null {
  try {
    const value = JSON.parse(readFileSync(path, 'utf8')) as Partial<ClaudeRefreshChainLeaseRecord>
    if (
      value.version !== 1 ||
      typeof value.processId !== 'number' ||
      typeof value.instanceId !== 'string' ||
      typeof value.instanceStartedAt !== 'number' ||
      typeof value.expiresAt !== 'number' ||
      (value.fingerprint !== null && typeof value.fingerprint !== 'string') ||
      (value.identityKey !== undefined &&
        value.identityKey !== null &&
        typeof value.identityKey !== 'string')
    ) {
      return null
    }
    return value as ClaudeRefreshChainLeaseRecord
  } catch {
    return null
  }
}

export function isProcessAlive(processId: number): boolean | null {
  try {
    process.kill(processId, 0)
    return true
  } catch (error) {
    if (isNodeError(error) && error.code === 'ESRCH') {
      return false
    }
    if (isNodeError(error) && error.code === 'EPERM') {
      return true
    }
    return null
  }
}

export function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error
}
