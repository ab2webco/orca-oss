import type { CommandSpec } from '../args'
import { GLOBAL_FLAGS } from '../args'

export const ORCHESTRATOR_GAME_COMMAND_SPECS: CommandSpec[] = [
  {
    path: ['game', 'state'],
    summary: 'Read the Agent Teams game state of the current terminal',
    usage: 'orca game state [--json]',
    allowedFlags: [...GLOBAL_FLAGS],
    examples: ['orca game state --json']
  },
  {
    path: ['game', 'lead'],
    summary: "Print the standing rules that make this session the project's lead",
    usage: 'orca game lead [--json]',
    allowedFlags: [...GLOBAL_FLAGS],
    notes: [
      "Orca's rules plus the project's own from orchestratorGame.orchestrator.rules in orca.yaml.",
      'A session a lead launched gets no rules: it reports to its lead.'
    ],
    examples: ['orca game lead']
  },
  {
    path: ['game', 'launch'],
    summary: "Start one member for a ticket in its own child worktree, as this project's lead",
    usage: 'orca game launch <ticket> [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'ticket'],
    positionalArgs: ['ticket'],
    notes: [
      'Run it from the lead terminal: the member reports to it through Orca orchestration.',
      'The agent, model, cap and prompt come from orchestratorGame.orchestrator in orca.yaml or the project Settings.',
      'Refused when the project cap of running members is reached.'
    ],
    examples: ['orca game launch CIN-1232 --json']
  },
  {
    path: ['game', 'scene', 'new'],
    summary: 'Start a project scene file from the built-in Quest scene',
    usage: 'orca game scene new <path> [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'path'],
    positionalArgs: ['path'],
    notes: [
      'Runs locally without contacting the Orca Lab runtime.',
      'Never overwrites: an existing file is an error.',
      'Keep project scenes under .orca/scenes/ so `orca game scene list` and Settings find them.'
    ],
    examples: ['orca game scene new .orca/scenes/space.json']
  },
  {
    path: ['game', 'scene', 'validate'],
    summary: 'Check a scene file with the same rules Orca and the game apply',
    usage: 'orca game scene validate <file> [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'file'],
    positionalArgs: ['file'],
    notes: [
      'Runs locally without contacting the Orca Lab runtime.',
      'Lists every problem as `path: message`; exits 1 when there is any.'
    ],
    examples: ['orca game scene validate .orca/scenes/space.json --json']
  },
  {
    path: ['game', 'scene', 'list'],
    summary: 'List the built-in scenes and the project scene files with their status',
    usage: 'orca game scene list [--json]',
    allowedFlags: [...GLOBAL_FLAGS],
    notes: [
      'Runs locally without contacting the Orca Lab runtime.',
      'Finds .orca/scenes/ in this folder or the nearest parent that has one.'
    ],
    examples: ['orca game scene list --json']
  }
]
