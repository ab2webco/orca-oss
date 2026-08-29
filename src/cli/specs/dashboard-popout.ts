import type { CommandSpec } from '../args'
import { GLOBAL_FLAGS } from '../args'

export const DASHBOARD_POPOUT_COMMAND_SPECS: CommandSpec[] = [
  {
    path: ['dashboard', 'popout', 'show'],
    summary: 'Read whether the Agent Dashboard popout is open',
    usage: 'orca dashboard popout show [--json]',
    allowedFlags: [...GLOBAL_FLAGS]
  },
  {
    path: ['dashboard', 'popout', 'open'],
    summary: 'Open the Agent Dashboard popout',
    usage: 'orca dashboard popout open [--json]',
    allowedFlags: [...GLOBAL_FLAGS]
  },
  {
    path: ['dashboard', 'popout', 'close'],
    summary: 'Close the Agent Dashboard popout',
    usage: 'orca dashboard popout close [--json]',
    allowedFlags: [...GLOBAL_FLAGS]
  }
]
