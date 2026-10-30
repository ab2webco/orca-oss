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
  },
  {
    path: ['game', 'resume'],
    summary: "Clear the project's persistent STOP so launches, waves and pushes run again",
    usage: 'orca game resume [--json]',
    allowedFlags: [...GLOBAL_FLAGS],
    notes: [
      'Run it only when the person says to resume. It relaunches nothing: launch or wave again after it.',
      'Posts a resumed event. A member cannot clear STOP; only the lead can.',
      'If the STOP file cannot be removed, the result says STOP is still set.'
    ],
    examples: ['orca game resume']
  },
  {
    path: ['game', 'resume-members'],
    summary: 'Bring back the members Orca or the machine restart left paused, or free them',
    usage: 'orca game resume-members [<ticket>[,<ticket>...]] [--discard] [--dry-run] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'tickets', 'discard', 'dry-run'],
    positionalArgs: ['tickets'],
    notes: [
      "`game fleet` lists paused members: the lead's members that ran before Orca closed or the machine restarted and are not live now. Their tickets stay held, so launch and wave never start a second member for one.",
      'Each is resumed in turn, never past the cap: a Claude member reopens its own conversation in its worktree on its account; any other member, or one whose conversation cannot reopen, starts a new agent in its worktree. Either way a fresh dispatch on its own task reports to this lead.',
      'A member whose task finished (worker_done succeeded) or whose worktree is gone is reported and not started.',
      "The lead binds the run that owns the members' tasks first; it never takes over that run while it leads live members in another.",
      '--discard frees the named members, or all of them; on a damaged saved file, it sets the file aside, bytes kept, and starts a new record. A file from a newer Orca is left as it is. Worktrees are never touched.'
    ],
    examples: [
      'orca game resume-members --dry-run',
      'orca game resume-members',
      'orca game resume-members CIN-12 --discard'
    ]
  },
  {
    path: ['game', 'inbox'],
    summary: "Messages to the lead or to one ticket's member, kept after the member closed",
    usage: 'orca game inbox [--ticket <id>] [--unread] [--mark-read] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'ticket', 'unread', 'mark-read'],
    notes: [
      "Reads Orca orchestration mail, which outlives a closed member and an app restart: the lead's terminal and run mailbox, or every terminal and dispatch the ticket's members had in the lead's current run. Newest first, the last 50.",
      'A member reads only its own ticket; the lead its own inbox, or a ticket with --ticket.',
      "A message is unread until the agent it was sent to read it (orchestration check) or --mark-read passed it. --mark-read moves the game's own read cursor and never marks orchestration mail read, so the lead's `orchestration check --wait` still gets it.",
      'A worker_done is shown once per dispatch, even when it was sent twice.',
      '`game state` gives the lead each inbox with its unread count and last message (`inboxes`).'
    ],
    examples: [
      'orca game inbox --unread',
      'orca game inbox --ticket CIN-12 --json',
      'orca game inbox --mark-read'
    ]
  },
  {
    path: ['game', 'ask-owner'],
    summary: 'Ask the person a question as a record they can find and answer, not chat text',
    usage:
      'orca game ask-owner --question <text> [--ticket <id>] [--option <text>]... [--context <link or line>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'question', 'ticket', 'option', 'context'],
    notes: [
      'Only the lead asks the person; a member asks its lead with `orchestration ask`. Kept on the Orca host that runs the lead, next to `game events`, until it is answered.',
      'Repeat --option for each choice, at most 6. --context is a link or one line that lets the person answer without your chat.',
      "The person's answer reaches you once as an escalation from `owner`, which your mail watch already passes. Record it on the ticket and act on it."
    ],
    examples: [
      'orca game ask-owner --ticket ORCA-12 --question "Ship the arcade in lab.111?" --option Yes --option "Wait for lab.112" --context "PR #41"'
    ]
  },
  {
    path: ['game', 'owner-questions'],
    summary: 'What the lead asked the person that still waits for an answer',
    usage: 'orca game owner-questions [--all] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'all'],
    notes: [
      'Open questions oldest first, with ticket, time asked, numbered options and context. --all adds the answered ones kept for the audit, the last 200.'
    ],
    examples: ['orca game owner-questions', 'orca game owner-questions --all --json']
  },
  {
    path: ['game', 'answer-owner'],
    summary: 'Answer a question the lead asked the person; the lead is told',
    usage: 'orca game answer-owner <id> (--pick <n> | --answer <text>) [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'id', 'pick', 'answer'],
    positionalArgs: ['id'],
    notes: [
      "The person's answer: --pick takes an option by its number in `game owner-questions`, --answer is free text.",
      'The lead receives it once as an escalation. The same answer again is a no-op; a different one is refused. A member cannot answer.'
    ],
    examples: [
      'orca game answer-owner oq_1a2b3c4d5e6f --pick 2',
      'orca game answer-owner oq_1a2b3c4d5e6f --answer "Wait until Monday"'
    ]
  }
]
