import type { CommandSpec } from '../args'
import { GLOBAL_FLAGS } from '../args'

/** Taking a member back after its terminal was replaced outside Orca (ORCA-914). */
export const ORCHESTRATOR_GAME_REBIND_COMMAND_SPECS: CommandSpec[] = [
  {
    path: ['game', 'rebind'],
    summary: 'Bind a member to the terminal it runs in after its own was replaced',
    usage: 'orca game rebind <ticket> [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'ticket'],
    positionalArgs: ['ticket'],
    notes: [
      'For a member whose terminal something replaced (an account switch outside Orca, a restart): its old dispatch stops and its task starts again, linked with --retry-of, on the one live terminal in its worktree, locally or on its paired host. Mail and the Panel then follow that terminal.',
      'Nothing changes while its own terminal still runs, or when the worktree has no live terminal or several; the result lists them.'
    ],
    examples: ['orca game rebind CIN-1297', 'orca game rebind CIN-1297 --json']
  }
]
