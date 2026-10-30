import type { CommandSpec } from '../args'
import { GLOBAL_FLAGS } from '../args'

export const WORKTREE_PROCESSES_COMMAND_SPECS: CommandSpec[] = [
  {
    path: ['worktree', 'processes'],
    summary: 'List the processes whose cwd is inside a worktree, and stop them with --stop',
    usage: 'orca worktree processes --worktree <selector> [--stop] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'worktree', 'stop'],
    notes: [
      'Runs on the SSH host for a remote worktree. --stop terminates only orphaned processes; anything with a live owner (an open terminal or agent, an editor, Orca, this shell) or another user is kept.'
    ]
  }
]
