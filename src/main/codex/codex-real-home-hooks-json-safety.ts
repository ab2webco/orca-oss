import { existsSync, mkdirSync, readFileSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import { writeFileAtomically } from '../codex-accounts/fs-utils'
import { resolveHooksJsonWritePath } from '../agent-hooks/hook-config-write-path'

// Guards around Orca's writes to the user's real ~/.codex/hooks.json:
// generation check before a write, a pristine backup, and byte-exact rollback.

/** Orca-side state dir; nothing extra is ever written into the user's ~/.codex. */
function getRealHomeHookStateDir(userDataPath: string): string {
  return join(userDataPath, 'codex-real-home-hooks')
}

export function assertHooksJsonGeneration(
  hooksJsonPath: string,
  hooksWritePath: string,
  expectedRaw: string | null
): void {
  const currentRaw = existsSync(hooksJsonPath) ? readFileSync(hooksJsonPath, 'utf-8') : null
  if (currentRaw !== expectedRaw || resolveHooksJsonWritePath(hooksJsonPath) !== hooksWritePath) {
    // Why: the pre-mutation RPC can overlap a user's editor save. Abort rather
    // than atomically replacing a newer file with the stale parsed snapshot.
    throw new Error('Codex hooks.json changed while Orca Lab prepared its trust repair')
  }
}

/** One-time pristine copy of the user's file, kept under Orca's userData. */
export function backupRealHomeHooksJsonOnce(
  userDataPath: string,
  previousRaw: string | null
): void {
  if (previousRaw === null) {
    return
  }
  const backupDir = getRealHomeHookStateDir(userDataPath)
  const backupPath = join(backupDir, 'hooks.json.pre-orca')
  if (existsSync(backupPath)) {
    return
  }
  // Why: this lane mutates the user's real Codex home. If the required
  // pristine recovery copy cannot be created, keep the managed lane intact.
  mkdirSync(backupDir, { recursive: true })
  writeFileAtomically(backupPath, previousRaw, { mode: 0o600 })
}

export function restoreRealHomeHooksJson(
  hooksJsonPath: string,
  previousRaw: string | null,
  previousMode?: number
): void {
  if (previousRaw === null) {
    if (existsSync(hooksJsonPath)) {
      unlinkSync(hooksJsonPath)
    }
    return
  }
  // Why: rollback is part of the safety boundary. Use the shared atomic
  // writer so Windows file-lock retries and failed-temp cleanup are covered.
  writeFileAtomically(hooksJsonPath, previousRaw, { mode: previousMode })
}
