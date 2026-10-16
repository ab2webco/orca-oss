import { loadHooks, parseOrcaYaml } from './hooks'
import { getSshFilesystemProvider } from './providers/ssh-filesystem-dispatch'
import { joinWorktreeRelativePath } from './runtime/runtime-relative-paths'
import type { OrcaHooks } from '../shared/orca-yaml-hook-types'

// Why: an SSH worktree's orca.yaml lives on its host; reading that path on this machine drops the project layer.
export async function readWorktreeOrcaYaml(
  worktreePath: string,
  connectionId: string | null | undefined
): Promise<OrcaHooks | null> {
  if (!connectionId) {
    return loadHooks(worktreePath)
  }
  const filesystem = getSshFilesystemProvider(connectionId)
  if (!filesystem) {
    return null
  }
  try {
    const result = await filesystem.readFile(joinWorktreeRelativePath(worktreePath, 'orca.yaml'))
    return result.isBinary ? null : parseOrcaYaml(result.content)
  } catch {
    return null
  }
}
