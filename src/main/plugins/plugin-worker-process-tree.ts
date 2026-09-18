import type { ChildProcess } from 'node:child_process'
import type { PluginCapabilityKind } from '../../shared/plugins/plugin-capabilities'
import { terminateWindowsProcessTree } from '../windows-process-tree-kill'

export function hasSpawnCapability(capabilities: readonly PluginCapabilityKind[]): boolean {
  return capabilities.includes('process:spawn')
}

export function terminatePluginWorkerTree(
  child: ChildProcess,
  capabilities: readonly PluginCapabilityKind[]
): void {
  if (hasSpawnCapability(capabilities) && child.pid) {
    if (process.platform === 'win32') {
      void terminateWindowsProcessTree(child.pid).finally(() => child.kill('SIGKILL'))
      return
    }
    try {
      process.kill(-child.pid, 'SIGKILL')
      return
    } catch {
      // The process group may already be gone; kill the direct worker below.
    }
  }
  child.kill('SIGKILL')
}
