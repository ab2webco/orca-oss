import type { ChildProcess } from 'node:child_process'
import type { PluginCapabilityKind } from '../../shared/plugins/plugin-capabilities'
import { terminateWindowsProcessTree } from '../windows-process-tree-kill'

function hasSpawnCapability(capabilities: readonly PluginCapabilityKind[]): boolean {
  return capabilities.includes('process:spawn')
}

/** Single source of truth for `fork({ detached })` and for every kill(-pid):
 *  only a detached worker owns its pid as a pgid. */
export function usesDetachedProcessGroup(capabilities: readonly PluginCapabilityKind[]): boolean {
  return hasSpawnCapability(capabilities) && process.platform !== 'win32'
}

/**
 * Sweeps the worker's process group. Safe to call after the worker itself is
 * gone: on POSIX the group outlives its dead leader. Windows has no equivalent
 * once the pid is released, so a post-exit sweep is POSIX-only.
 */
export function reapPluginWorkerGroup(
  pid: number | undefined,
  capabilities: readonly PluginCapabilityKind[]
): boolean {
  if (pid === undefined || !usesDetachedProcessGroup(capabilities)) {
    return false
  }
  try {
    process.kill(-pid, 'SIGKILL')
    return true
  } catch {
    return false
  }
}

export function terminatePluginWorkerTree(
  child: ChildProcess,
  capabilities: readonly PluginCapabilityKind[]
): void {
  if (hasSpawnCapability(capabilities) && child.pid && process.platform === 'win32') {
    void terminateWindowsProcessTree(child.pid).finally(() => child.kill('SIGKILL'))
    return
  }
  if (reapPluginWorkerGroup(child.pid, capabilities)) {
    return
  }
  child.kill('SIGKILL')
}
