import type { CommandSpec } from '../args'
import { GLOBAL_FLAGS } from '../args'

export const ORCHESTRATOR_GAME_COMMAND_SPECS: CommandSpec[] = [
  {
    path: ['game', 'state'],
    summary: 'Read the Agent Teams game state of the current terminal',
    usage: 'orca game state [--json]',
    allowedFlags: [...GLOBAL_FLAGS],
    examples: ['orca game state --json']
  }
]
