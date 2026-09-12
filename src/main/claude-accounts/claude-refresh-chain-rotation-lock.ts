import { mkdirSync, rmSync, statSync } from 'node:fs'
import { isNodeError } from './claude-refresh-chain-lease-record'
import { touchClaudeRefreshRotationLock } from './claude-refresh-chain-lease-paths'

/**
 * Take the machine-wide directory lock that makes one chain's rotation exclusive across Orca
 * instances. A lock older than `staleAfterMs` is reaped: an instance killed mid-rotation must not
 * block every later refresh, which is how a stranded claim once froze rotation for good.
 */
export function acquireClaudeRefreshRotationLock(
  lockPath: string,
  instanceId: string,
  nowMs: number,
  staleAfterMs: number
): boolean {
  if (createLockDirectory(lockPath, instanceId, nowMs)) {
    return true
  }
  if (statSync(lockPath).mtimeMs + staleAfterMs > nowMs) {
    return false
  }
  rmSync(lockPath, { recursive: true, force: true })
  return createLockDirectory(lockPath, instanceId, nowMs)
}

function createLockDirectory(lockPath: string, instanceId: string, nowMs: number): boolean {
  try {
    mkdirSync(lockPath, { mode: 0o700 })
  } catch (error) {
    if (isNodeError(error) && error.code === 'EEXIST') {
      return false
    }
    throw error
  }
  touchClaudeRefreshRotationLock(lockPath, instanceId, nowMs)
  return true
}
