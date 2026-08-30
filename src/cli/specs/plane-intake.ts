import type { CommandSpec } from '../args'
import { GLOBAL_FLAGS } from '../args'

export const PLANE_INTAKE_COMMAND_SPECS: CommandSpec[] = [
  {
    path: ['plane', 'intake', 'create'],
    summary: 'Create a Plane intake item',
    usage:
      'orca plane intake create --project <id> --title <title> [--body <text> | --body-file <path|->] [--priority none|low|medium|high|urgent] [--workspace <id>] [--json]',
    allowedFlags: [
      ...GLOBAL_FLAGS,
      'project',
      'title',
      'body',
      'body-file',
      'priority',
      'workspace'
    ],
    examples: [
      'orca plane intake create --project <projectId> --title "Customer cannot sign in" --priority high --json'
    ],
    notes: [
      'Creates a pending item in Plane Triage; state, parent, assignee, and labels are intentionally unavailable.'
    ]
  },
  {
    path: ['plane', 'intake', 'list'],
    summary: 'List Plane intake items',
    usage: 'orca plane intake list --project <id> [--limit <n>] [--workspace <id>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'project', 'limit', 'workspace'],
    examples: ['orca plane intake list --project <projectId> --limit 20 --json']
  }
]
