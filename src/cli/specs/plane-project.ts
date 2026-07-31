import type { CommandSpec } from '../args'
import { GLOBAL_FLAGS } from '../args'

// Plane has no project hierarchy at all, and the CLI is where an agent finds
// that out: every write below is workspace-scoped, so there is nowhere to hang
// a "parent project". Repeated in create's notes because that is the surface a
// caller reaching for a subproject actually reads.
const NO_NESTING_NOTE =
  'Plane does NOT nest projects: there is no parent project field. Model a subproject as a module (orca plane module list) or as a parent work item (orca plane create --parent <id>) inside one project.'

export const PLANE_PROJECT_COMMAND_SPECS: CommandSpec[] = [
  {
    path: ['plane', 'project', 'create'],
    summary: 'Create a Plane project',
    usage:
      'orca plane project create --name <name> --identifier <ID> [--description <text>] [--workspace <slug-or-id>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'name', 'identifier', 'description', 'workspace'],
    examples: [
      'orca plane project create --name "Billing revamp" --identifier BILL --json',
      'orca plane project create --name "Billing revamp" --identifier BILL --description "Q3 rewrite" --workspace acme --json'
    ],
    notes: [
      NO_NESTING_NOTE,
      '--identifier is the short work-item prefix (BILL-1, BILL-2); Plane rejects one already used in the workspace.',
      '--workspace accepts a workspace slug or a saved workspace id; omit it to use the workspace Orca has selected.',
      'Uses the Plane credentials Orca already manages — no API key goes on the command line.'
    ]
  },
  {
    path: ['plane', 'project', 'update'],
    summary: 'Update a Plane project name, identifier, or description',
    usage:
      'orca plane project update --project <id> [--name <name>] [--identifier <ID>] [--description <text>] [--workspace <slug-or-id>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'project', 'name', 'identifier', 'description', 'workspace'],
    examples: [
      'orca plane project update --project <projectId> --name "Billing platform" --json',
      'orca plane project update --project <projectId> --description "" --json'
    ],
    notes: [
      'Only the flags you pass are written; everything else is left untouched.',
      'Pass --description "" to clear the description.',
      NO_NESTING_NOTE
    ]
  },
  {
    path: ['plane', 'project', 'archive'],
    summary: 'Archive a Plane project',
    usage: 'orca plane project archive --project <id> [--workspace <slug-or-id>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'project', 'workspace'],
    destructive: true,
    examples: ['orca plane project archive --project <projectId> --json'],
    notes: [
      'Archiving hides the project; work items, cycles, and modules are preserved.',
      'Archived projects drop out of project list unless you pass --archived, so record the project id before archiving — unarchive needs it.'
    ]
  },
  {
    path: ['plane', 'project', 'unarchive'],
    summary: 'Restore an archived Plane project',
    usage: 'orca plane project unarchive --project <id> [--workspace <slug-or-id>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'project', 'workspace'],
    examples: ['orca plane project unarchive --project <projectId> --json'],
    notes: [
      'Takes the project id an archived project had; find it again with orca plane project list --archived.'
    ]
  }
]
