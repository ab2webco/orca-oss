import type { CommandSpec } from '../args'
import { GLOBAL_FLAGS } from '../args'

export const WORKTREE_RM_COMMAND_SPECS: CommandSpec[] = [
  {
    path: ['worktree', 'rm'],
    // Why: agents reach for git's `remove`/`delete` verbs; accept them as
    // aliases so a conventional guess resolves instead of dead-ending.
    aliases: [
      ['worktree', 'remove'],
      ['worktree', 'delete']
    ],
    destructive: true,
    summary: 'Remove a worktree from Orca Lab and git',
    usage:
      'orca worktree rm --worktree <selector> [--environment <host>] [--force] [--force-member] [--run-hooks] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'worktree', 'force', 'force-member', 'run-hooks'],
    notes: [
      'Repo-defined orca.yaml archive hooks are skipped unless --run-hooks is passed.',
      'With --environment <host> the paired host removes its own worktree with the same dirty-tree and member checks, without SSH; pass a server-side selector (id:, path:, branch:, name:), not active/current.'
    ],
    examples: [
      'orca worktree list --environment imac --json',
      'orca worktree rm --environment imac --worktree branch:feature/x --json'
    ]
  }
]
