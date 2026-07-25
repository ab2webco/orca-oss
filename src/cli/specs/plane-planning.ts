import type { CommandSpec } from '../args'
import { GLOBAL_FLAGS } from '../args'

function planningSpecs(kind: 'cycle' | 'module'): CommandSpec[] {
  const title = kind === 'cycle' ? 'cycle' : 'module'
  return [
    {
      path: ['plane', kind, 'list'],
      summary: `List Plane ${title}s`,
      usage: `orca plane ${kind} list --project <id> [--workspace <id>] [--json]`,
      allowedFlags: [...GLOBAL_FLAGS, 'project', 'workspace'],
      examples: [`orca plane ${kind} list --project <projectId> --json`]
    },
    {
      path: ['plane', kind, 'issues'],
      summary: `List work items in a Plane ${title}`,
      usage: `orca plane ${kind} issues <${kind}Id> --project <id> [--workspace <id>] [--json]`,
      allowedFlags: [...GLOBAL_FLAGS, 'project', 'workspace', `${kind}Id`],
      positionalArgs: [`${kind}Id`],
      examples: [`orca plane ${kind} issues <${kind}Id> --project <projectId> --json`]
    },
    {
      path: ['plane', kind, 'add-items'],
      summary: `Add work items to a Plane ${title}`,
      usage: `orca plane ${kind} add-items <${kind}Id> --item <workItemId>... --project <id> [--workspace <id>] [--json]`,
      allowedFlags: [...GLOBAL_FLAGS, 'item', 'project', 'workspace', `${kind}Id`],
      positionalArgs: [`${kind}Id`],
      examples: [
        `orca plane ${kind} add-items <${kind}Id> --item <workItemId> --project <projectId> --json`
      ],
      notes: ['Repeat --item to add multiple work item UUIDs in one request.']
    }
  ]
}

export const PLANE_PLANNING_COMMAND_SPECS: CommandSpec[] = [
  ...planningSpecs('cycle'),
  ...planningSpecs('module')
]
