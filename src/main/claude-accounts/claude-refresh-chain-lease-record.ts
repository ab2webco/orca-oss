import { readFileSync } from 'node:fs'
import type { ClaudeRefreshChainFingerprint } from './claude-refresh-chain-fingerprint'

export type ClaudeRefreshChainLeaseRecord = {
  version: 1
  processId: number
  instanceId: string
  instanceStartedAt: number
  expiresAt: number
  fingerprint: ClaudeRefreshChainFingerprint | null
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
      (value.fingerprint !== null && typeof value.fingerprint !== 'string')
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
