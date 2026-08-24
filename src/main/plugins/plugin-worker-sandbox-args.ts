import { dirname, extname, join } from 'node:path'

export function buildPluginWorkerSandboxArgs(rootDir: string, entryPath: string): string[] {
  const hostDir = dirname(entryPath)
  const preloadPath = join(hostDir, `plugin-host-preload${extname(entryPath) || '.js'}`)
  return [
    '--preserve-symlinks',
    '--preserve-symlinks-main',
    '--permission',
    `--allow-fs-read=${rootDir}`,
    `--allow-fs-read=${hostDir}`,
    '--require',
    preloadPath
  ]
}
