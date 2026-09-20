/** Whether the process that wrote a runtime metadata file is still around. */
export function isProcessRunning(pid: number | null | undefined): boolean {
  if (!pid || pid <= 0) {
    return false
  }
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    // Why: EPERM proves the PID exists even when the caller cannot inspect it.
    if (isPermissionDenied(error)) {
      return true
    }
    return false
  }
}

function isPermissionDenied(error: unknown): boolean {
  if (!error || typeof error !== 'object' || !('code' in error)) {
    return false
  }
  return error.code === 'EPERM' || error.code === 'EACCES'
}
