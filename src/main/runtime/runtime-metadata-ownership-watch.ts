import { getRuntimeMetadataPath, type RuntimeMetadata } from '../../shared/runtime-bootstrap'
import { readRuntimeMetadata } from './runtime-metadata'

// Why: a live owner must reclaim discovery metadata clobbered by a runtime that has died.
export const RUNTIME_METADATA_OWNERSHIP_POLL_MS = 10_000

export type RuntimeMetadataOwnershipWatch = {
  check: () => void
  stop: () => void
}

export type RuntimeMetadataOwnershipWatchOptions = {
  userDataPath: string
  ownedPid: number
  ownedRuntimeId: string
  republish: () => void
  pollIntervalMs?: number
  isProcessRunning?: (pid: number) => boolean
  onReclaim?: (previous: RuntimeMetadata | null) => void
}

export function shouldReclaimRuntimeMetadata(
  current: RuntimeMetadata | null,
  ownedPid: number,
  ownedRuntimeId: string,
  isProcessRunning: (pid: number) => boolean
): boolean {
  if (!current) {
    return true
  }
  if (current.pid === ownedPid && current.runtimeId === ownedRuntimeId) {
    return false
  }
  // Why: another runtime cannot share this process's pid.
  if (current.pid === ownedPid) {
    return true
  }
  return !isProcessRunning(current.pid)
}

export function watchRuntimeMetadataOwnership(
  options: RuntimeMetadataOwnershipWatchOptions
): RuntimeMetadataOwnershipWatch {
  const isProcessRunning = options.isProcessRunning ?? isPidRunning
  const check = (): void => {
    const current = tryReadRuntimeMetadata(options.userDataPath)
    if (
      !shouldReclaimRuntimeMetadata(
        current,
        options.ownedPid,
        options.ownedRuntimeId,
        isProcessRunning
      )
    ) {
      return
    }
    try {
      options.republish()
    } catch (error) {
      // Why: a transient write failure must not kill the watch; the next tick retries.
      console.error('[runtime] Failed to reclaim runtime metadata ownership:', error)
      return
    }
    options.onReclaim?.(current)
  }

  const timer = setInterval(check, options.pollIntervalMs ?? RUNTIME_METADATA_OWNERSHIP_POLL_MS)
  // Why: discovery bookkeeping must never be the reason the process stays alive.
  timer.unref?.()
  return {
    check,
    stop: () => clearInterval(timer)
  }
}

function tryReadRuntimeMetadata(userDataPath: string): RuntimeMetadata | null {
  try {
    return readRuntimeMetadata(userDataPath)
  } catch (error) {
    // Why: unreadable metadata cannot describe a live runtime.
    console.warn(
      `[runtime] Ignoring unreadable ${getRuntimeMetadataPath(userDataPath)}:`,
      error instanceof Error ? error.message : String(error)
    )
    return null
  }
}

function isPidRunning(pid: number): boolean {
  if (!pid || pid <= 0) {
    return false
  }
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    // Why: only ESRCH proves death; EPERM means the pid may still be live.
    return (error as NodeJS.ErrnoException).code !== 'ESRCH'
  }
}
