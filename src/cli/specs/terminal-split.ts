import type { CommandSpec } from '../args'
import { GLOBAL_FLAGS } from '../args'

export const TERMINAL_SPLIT_COMMAND_SPECS: CommandSpec[] = [
  {
    path: ['terminal', 'split'],
    summary: 'Split an existing terminal pane',
    usage:
      'orca terminal split [--terminal <handle>] [--direction horizontal|vertical] [--command <text>] [--claude-account <email|id>] [--codex-account <email|id>] [--json]',
    allowedFlags: [
      ...GLOBAL_FLAGS,
      'terminal',
      'direction',
      'command',
      'claude-account',
      'codex-account'
    ],
    notes: [
      'Pass --claude-account or --codex-account (email or id from `orca account list --json`) to launch the new pane against a specific managed account. The launch flag beats the worktree account pin; the pin beats the global selection.',
      'An account-directed split always spawns on the background path because the renderer-backed split path cannot carry a launch-account override.'
    ],
    examples: [
      'orca terminal split --terminal term_abc123 --direction horizontal --json',
      'orca terminal split --terminal term_abc123 --command "codex"',
      'orca terminal split --terminal term_abc123 --command "codex" --codex-account dev@example.com --json'
    ]
  }
]
