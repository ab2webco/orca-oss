import type { CommandSpec } from '../args'
import { GLOBAL_FLAGS } from '../args'

export const WORKTREE_PROCESSES_COMMAND_SPECS: CommandSpec[] = [
  {
    path: ['worktree', 'processes'],
    summary: 'List the processes whose cwd is inside a worktree, and stop them with --stop',
    usage: 'orca worktree processes --worktree <selector> [--stop] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'worktree', 'stop'],
    notes: [
      'Runs on the SSH host for a remote worktree. --stop never signals Orca, the calling shell, their ancestors or another user.'
    ]
  }
]
