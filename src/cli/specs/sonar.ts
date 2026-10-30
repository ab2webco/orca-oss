import type { CommandSpec } from '../args'
import { GLOBAL_FLAGS } from '../args'

export const SONAR_COMMAND_SPECS: CommandSpec[] = [
  {
    path: ['sonar'],
    argumentMode: 'passthrough',
    summary: 'Run the installed orca-sonar plugin CLI (find, symbol, index)',
    usage: 'orca sonar <command> [args...]',
    allowedFlags: [...GLOBAL_FLAGS],
    notes: [
      'Forwards every following argument to the orca-sonar CLI installed in Orca Lab.',
      'The index lives in Orca Lab data and never inside the repository.',
      'Needs Node 24 or newer on PATH and the orca-sonar plugin installed and enabled in Orca Lab.'
    ],
    examples: ['orca sonar find Tab --json', 'orca sonar symbol runCli']
  }
]
