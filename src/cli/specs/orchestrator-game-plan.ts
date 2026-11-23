import type { CommandSpec } from '../args'
import { GLOBAL_FLAGS } from '../args'

/** The lead's per-ticket effort plan, the Orca steward's prior (ORCA-1242). */
export const ORCHESTRATOR_GAME_PLAN_COMMAND_SPECS: CommandSpec[] = [
  {
    path: ['game', 'plan'],
    summary: "Read or write a ticket's effort plan: the model and effort for each phase, and why",
    usage: 'orca game plan <ticket> [--phase <name:model:effort:why> ...] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'ticket', 'phase'],
    positionalArgs: ['ticket'],
    notes: [
      'Without --phase it prints the plan. With one or more --phase it replaces the whole plan, in the order given; only the lead writes it.',
      'Phases: map, design, implement, test-fix, captures, pr-ci. Models are Claude ids, with or without `claude-` (opus-5-5). Efforts: low, medium, high, xhigh, max. The why may hold colons.',
      '`orca game launch --kind` seeds the kind default when Orca picks a Claude member model; a relaunch never replaces a plan the lead wrote.',
      'A member reads its own plan with the same command.'
    ],
    examples: [
      'orca game plan ORCA-12',
      'orca game plan ORCA-12 --phase "map:opus-5-5:medium:map the relay" --phase "implement:opus-5-5:high:risky path src/main/runtime" --phase "pr-ci:opus-5-5:low:watch CI"'
    ]
  },
  {
    path: ['game', 'steward-log'],
    summary:
      "Print the Orca steward's decisions for a ticket: moment, phase, model and effort moves, and why",
    usage: 'orca game steward-log <ticket> [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'ticket'],
    positionalArgs: ['ticket'],
    notes: [
      "Each member pane's steward sends its latest decisions on its state poll; Orca appends them, oldest first, to one log per project and ticket.",
      'A decision marked "not applied" was made while another router or a person\'s /model was in charge.'
    ],
    examples: ['orca game steward-log ORCA-12', 'orca game steward-log ORCA-12 --json']
  }
]
