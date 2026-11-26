import { GLOBAL_FLAGS, type CommandSpec } from '../args'

export const ORCHESTRATOR_GAME_WATCH_COMMAND_SPECS: CommandSpec[] = [
  {
    path: ['game', 'watch'],
    summary: "Print a line each time the lead's fleet changes, for the game band to refresh on",
    usage: 'orca game watch [--lead]',
    allowedFlags: [...GLOBAL_FLAGS, 'lead'],
    notes: [
      'Prints `ready <version>` once, then `fleet <version>` on each member launch, release, stop, state change, STOP switch or orchestration message. Runs until Orca closes.',
      'An Orca host without it fails with an unknown-method error; the band then refreshes on its poll alone.',
      '--lead prints `alert <line>` instead of fleet ticks, once per condition the lead must act on: a member gone from its host, limited, needing you, orphaned, idle with no PR open or queued for its ticket, on red CI the GitHub merge state does not clear, with a merged PR, paused, or with a launch queued 20+ min; mail waiting on the lead with no reply, or an owner answer not yet acked; a merge-queue entry failed, dropped, merged, past 3 h, or with a run past 1 h. It re-prints an alert that clears and comes back. It reads the same cached state as the band, on each fleet change and at most once a minute otherwise, so it adds no GitHub polling.'
    ],
    examples: ['orca game watch', 'orca game watch --lead']
  }
]
