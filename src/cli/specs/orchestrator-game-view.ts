import { GLOBAL_FLAGS, type CommandSpec } from '../args'

export const ORCHESTRATOR_GAME_VIEW_COMMAND_SPECS: CommandSpec[] = [
  {
    path: ['game', 'view'],
    summary: 'Store the Agent Teams game view for this project or every project',
    usage: 'orca game view <off|flat|zen|2d-classic|2d-hd> --scope <project|global> [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'view', 'scope'],
    positionalArgs: ['view'],
    notes: [
      "--scope project stores it for the calling pane's repo on this machine (Settings → the project); global stores it for every project.",
      "A view is stored as orchestratorGame.mode and render; orca.yaml is never written. For every project, a project's own setting (this machine or orca.yaml) still wins.",
      "One pane alone changes with the game's /orca-game:view; an older host refuses this command."
    ],
    examples: ['orca game view flat --scope project', 'orca game view 2d-hd --scope global --json']
  },
  {
    path: ['game', 'hide-tab'],
    summary: "Hide a native panel tab for the calling pane's project on this machine",
    usage: 'orca game hide-tab <prs|queue|machines> [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'tab'],
    positionalArgs: ['tab'],
    notes: [
      'The game mod runs it once to carry a Panel layout that hid My PRs over to the native panel.',
      "A choice the project's own layer already holds is left as it is, and an older host refuses this command."
    ],
    examples: ['orca game hide-tab prs --json']
  }
]
