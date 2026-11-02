import type { CommandSpec } from '../args'
import { GLOBAL_FLAGS } from '../args'

/** The lead choosing which agents are in its fleet: adopt one, or drop one without killing it (ORCA-943). */
export const ORCHESTRATOR_GAME_ADOPT_COMMAND_SPECS: CommandSpec[] = [
  {
    path: ['game', 'adopt'],
    summary:
      'Make an agent found on this machine or a paired host a member, so mail reaches it both ways',
    usage: 'orca game adopt <name|ticket> [--force] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'name', 'force'],
    positionalArgs: ['name'],
    notes: [
      'For a found agent of this project on this machine or a paired host (the fleet lists it as found): its task starts on its own terminal, with worker-start (--on for a host), and lead mail then reaches it and its reports reach the lead.',
      'An agent dropped with `orca game drop` comes back into the fleet first.',
      'Refused while the agent is mid-turn (unless --force), when it leads a Run on its host, or when its terminal no longer runs. Adopting an agent already adopted reuses its dispatch.'
    ],
    examples: ['orca game adopt ORCA-915', 'orca game adopt orca-915 --force --json']
  },
  {
    path: ['game', 'drop'],
    summary: "Take an agent out of the lead's fleet without stopping it or touching its worktree",
    usage: 'orca game drop <name|ticket> [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'name'],
    positionalArgs: ['name'],
    notes: [
      'The agent stays out of the fleet and the Panel across refreshes and restarts, and is not resumed after a restart, until `orca game adopt` brings it back.',
      'A member on this machine whose dispatch still reports to the lead is detached first: the dispatch ends, its pane keeps running. One on a paired host is refused until that host can detach it.'
    ],
    examples: ['orca game drop ORCA-915', 'orca game drop orca-907 --json']
  }
]
