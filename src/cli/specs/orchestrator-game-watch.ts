import { GLOBAL_FLAGS, type CommandSpec } from '../args'

export const ORCHESTRATOR_GAME_WATCH_COMMAND_SPECS: CommandSpec[] = [
  {
    path: ['game', 'watch'],
    summary: "Print a line each time the lead's fleet changes, for the game band to refresh on",
    usage: 'orca game watch',
    allowedFlags: [...GLOBAL_FLAGS],
    notes: [
      'Prints `ready <version>` once, then `fleet <version>` on each member launch, release, stop, state change, STOP switch or orchestration message. Runs until Orca closes.',
      'An Orca host without it fails with an unknown-method error; the band then refreshes on its poll alone.'
    ],
    examples: ['orca game watch']
  }
]
