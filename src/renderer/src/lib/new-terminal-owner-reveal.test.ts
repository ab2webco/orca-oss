// ORCA-1192: every + menu terminal brings its owner row into view, passively.
import { describe, expect, it, vi } from 'vitest'
import { FLOATING_TERMINAL_WORKTREE_ID } from '../../../shared/constants'
import { revealNewTerminalOwnerRow } from './new-terminal-owner-reveal'

describe('revealNewTerminalOwnerRow', () => {
  it('asks for a passive reveal of the owner row', () => {
    const revealWorktreeInSidebar = vi.fn()

    revealNewTerminalOwnerRow({ revealWorktreeInSidebar }, 'folder:notes')

    expect(revealWorktreeInSidebar).toHaveBeenCalledWith('folder:notes', { passive: true })
  })

  it('skips the floating terminal, which has no sidebar row', () => {
    const revealWorktreeInSidebar = vi.fn()

    revealNewTerminalOwnerRow({ revealWorktreeInSidebar }, FLOATING_TERMINAL_WORKTREE_ID)

    expect(revealWorktreeInSidebar).not.toHaveBeenCalled()
  })
})
