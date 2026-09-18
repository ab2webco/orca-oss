import { dirname, extname, join } from 'node:path'
import type { PluginCapabilityKind } from '../../shared/plugins/plugin-capabilities'

export function buildPluginWorkerSandboxArgs(
  rootDir: string,
  entryPath: string,
  grantedCapabilities: readonly PluginCapabilityKind[]
): string[] {
  const hostDir = dirname(entryPath)
  const preloadPath = join(hostDir, `plugin-host-preload${extname(entryPath) || '.js'}`)
  const args = [
    '--preserve-symlinks',
    '--preserve-symlinks-main',
    '--permission',
    `--allow-fs-read=${rootDir}`,
    `--allow-fs-read=${hostDir}`,
    '--require',
    preloadPath
  ]
  if (grantedCapabilities.includes('process:spawn')) {
    args.push('--allow-child-process')
  }
  return args
}
