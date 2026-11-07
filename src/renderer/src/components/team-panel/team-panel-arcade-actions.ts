import type { RuntimeClientTarget } from '@/runtime/runtime-rpc-client'
import type { GameInboxScope } from '../game-inbox/game-owner-questions-client'
import type { TeamArcadeActions } from './TeamArcadeSection'

/**
 * Play and Keep for the Team tab; null hides the arcade. The credit belongs to the lead's
 * project, while the Arcade tab opens in this window's worktree, which a paired host's lead lacks.
 */
export function teamArcadeActionsOf(args: {
  /** The panel's arcade setting, after global Settings and this machine's choice for the project. */
  enabled: boolean
  target: RuntimeClientTarget
  leadWorktreeId: string | null
  activeWorktreeId: string | null
  play: (scope: GameInboxScope, open: (worktreeId: string) => void) => Promise<boolean>
  keep: (scope: GameInboxScope) => Promise<boolean>
  openTab: (worktreeId: string) => void
  refresh: () => void
  failed: (error: unknown) => void
}): TeamArcadeActions | null {
  const { leadWorktreeId, activeWorktreeId } = args
  if (!args.enabled || !leadWorktreeId || !activeWorktreeId) {
    return null
  }
  const scope = { target: args.target, worktreeId: leadWorktreeId }
  // Why refresh either way: the host may have changed the count even when the reply was lost.
  const settle = async (choice: () => Promise<unknown>): Promise<void> => {
    try {
      await choice()
    } catch (error) {
      args.failed(error)
    } finally {
      args.refresh()
    }
  }
  return {
    play: () => settle(() => args.play(scope, () => args.openTab(activeWorktreeId))),
    keep: () => settle(() => args.keep(scope))
  }
}
