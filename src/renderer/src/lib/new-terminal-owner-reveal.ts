import { FLOATING_TERMINAL_WORKTREE_ID } from '../../../shared/constants'
import type { AppState } from '@/store/types'

/** A + menu terminal can open while its row is folded or scrolled away (ORCA-1192); the floating terminal has no row. */
export function revealNewTerminalOwnerRow(
  state: Pick<AppState, 'revealWorktreeInSidebar'>,
  worktreeId: string
): void {
  if (worktreeId !== FLOATING_TERMINAL_WORKTREE_ID) {
    state.revealWorktreeInSidebar(worktreeId, { passive: true })
  }
}
