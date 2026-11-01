import type { CommandSpec } from '../args'
import { GLOBAL_FLAGS } from '../args'

export const TERMINAL_WAKE_COMMAND_SPECS: CommandSpec[] = [
  {
    path: ['terminal', 'wake'],
    summary: 'Wake a sleeping agent terminal, resuming its conversation on the same account',
    usage: 'orca terminal wake --terminal <handle> [--environment <host>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'terminal'],
    notes: [
      'Does what clicking the sleeping terminal in its window does, without changing what that window shows.',
      'Prints the handle the agent runs under once awake; a host that predates this command answers unsupported.'
    ],
    examples: [
      'orca terminal wake --terminal term_abc123',
      'orca terminal wake --terminal term_abc123 --environment imac --json'
    ]
  }
]
