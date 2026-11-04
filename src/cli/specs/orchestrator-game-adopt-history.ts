import type { CommandSpec } from '../args'
import { GLOBAL_FLAGS } from '../args'

/** Recovering the game data a re-added repo left under its old repo id (ORCA-1011). */
export const ORCHESTRATOR_GAME_ADOPT_HISTORY_COMMAND_SPECS: CommandSpec[] = [
  {
    path: ['game', 'adopt-history'],
    summary:
      "Fold the game history, lessons and STOP a removed repo id left behind into this project's",
    usage: 'orca game adopt-history --from-repo-id <id> [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'from-repo-id'],
    notes: [
      'Game data written before Orca named it by repo path, or left at a path the repo moved from, stays under the old repo id while the project reads empty. This merges them into the current project: records and events by time, lesson counts added, a STOP kept set.',
      "Run it on the lead's host from an Orca terminal in the project, with no lead or member of the project live. A repo id Orca still has is refused.",
      'The old files are renamed with `.adopted-` beside the store, never deleted, so a second run finds nothing. Saved members, the lead conversation and drops are not carried: they name worktrees of the old repo id.'
    ],
    examples: ['orca game adopt-history --from-repo-id 8e9e530d-0000-4000-8000-000000000000']
  }
]
