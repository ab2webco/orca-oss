import type { CommandSpec } from '../args'
import { GLOBAL_FLAGS } from '../args'

/** The project's shared board: its event record, the STOP switch and the inboxes. */
export const ORCHESTRATOR_GAME_BOARD_COMMAND_SPECS: CommandSpec[] = [
  {
    path: ['game', 'events'],
    summary:
      "The project's event record: claims, PRs, merges, QA handoffs, parked questions, failures, stop and resume",
    usage: 'orca game events [--ticket <id>] [--since <date>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'ticket', 'since'],
    notes: [
      'Kinds: claimed, pr_opened, merged, qa_handoff, question_parked, failed, stopped, resumed; newest first.',
      '`game launch` posts claimed, `game sweep` and `game fleet` post merged and qa_handoff once each, `game stop --hold` and `game resume` post stopped and resumed; members post their own with `orca game event`.',
      'Kept per project on the Orca host that runs the lead, next to `game history`, the last 500 events. Read-only.'
    ],
    examples: ['orca game events', 'orca game events --ticket CIN-12 --json']
  },
  {
    path: ['game', 'event'],
    summary: "Post one event to the project's event record",
    usage: 'orca game event <kind> [--text <text>] [--ticket <id>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'kind', 'text', 'ticket'],
    positionalArgs: ['kind'],
    notes: [
      'Kinds: claimed, pr_opened, merged, qa_handoff, question_parked, failed, stopped, resumed.',
      'A member posts under its own ticket, whatever --ticket says; the lead names the ticket with --ticket.',
      '--text is at most 600 characters.'
    ],
    examples: [
      'orca game event pr_opened --text "PR #41 open"',
      'orca game event question_parked --text "Which seat map?"'
    ]
  }
]
