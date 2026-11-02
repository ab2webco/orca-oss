import type { CommandSpec } from '../args'
import { GLOBAL_FLAGS } from '../args'

/** Making an agent found on a paired host a member the lead can mail (ORCA-943). */
export const ORCHESTRATOR_GAME_ADOPT_COMMAND_SPECS: CommandSpec[] = [
  {
    path: ['game', 'adopt'],
    summary: 'Make an agent found on a paired host a member, so mail reaches it both ways',
    usage: 'orca game adopt <name|ticket> [--force] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'name', 'force'],
    positionalArgs: ['name'],
    notes: [
      'For a found agent of this project on a paired host (the fleet lists it as found): its task starts on its own terminal there, with worker-start --on, and lead mail then reaches it and its reports reach the lead.',
      'Refused while the agent is mid-turn (unless --force), when it leads a Run on its host, or when its terminal no longer runs. Adopting an agent already adopted reuses its dispatch.'
    ],
    examples: ['orca game adopt ORCA-915', 'orca game adopt orca-915 --force --json']
  }
]
