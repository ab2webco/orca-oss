import type { CommandSpec } from '../args'
import { GLOBAL_FLAGS } from '../args'

export const PLANE_COMMAND_SPECS: CommandSpec[] = [
  {
    path: ['plane', 'create'],
    summary: 'Create a Plane work item',
    usage:
      'orca plane create --project <id> --title <title> [--body <text> | --body-file <path|->] [--state <name-or-id>] [--assignee me|<userId>] [--priority none|low|medium|high|urgent] [--label <labelId>]... [--workspace <id>] [--json]',
    allowedFlags: [
      ...GLOBAL_FLAGS,
      'project',
      'title',
      'body',
      'body-file',
      'state',
      'assignee',
      'priority',
      'label',
      'workspace'
    ],
    examples: [
      'orca plane create --project <projectId> --title "Investigate flaky login" --json',
      'orca plane create --project <projectId> --title "Follow-up" --assignee me --body-file - --json'
    ],
    notes: [
      'Use --body-file - to read a multiline description from stdin.',
      'Repeated --label sets the label set from the provided label ids.'
    ]
  },
  {
    path: ['plane', 'issue'],
    summary: 'Read Plane work item context for agents',
    usage: 'orca plane issue <id> [--comments] [--project <id>] [--workspace <id>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'comments', 'project', 'workspace', 'id'],
    positionalArgs: ['id'],
    examples: [
      'orca plane issue PROJ-12 --json',
      'orca plane issue PROJ-12 --comments --project <projectId> --json'
    ]
  },
  {
    path: ['plane', 'list'],
    summary: 'List Plane work items for task triage',
    usage:
      'orca plane list [--filter everything|assigned|created|all|done] [--project <id>] [--limit <n>] [--workspace <id>|all] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'filter', 'project', 'limit', 'workspace'],
    examples: ['orca plane list --filter assigned --limit 10 --json']
  },
  {
    path: ['plane', 'search'],
    summary: 'Search connected Plane workspaces with PQL',
    usage: 'orca plane search <query> [--project <id>] [--workspace <id>|all] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'project', 'workspace', 'query'],
    positionalArgs: ['query'],
    examples: ['orca plane search \'state = "In Progress"\' --workspace all --json']
  },
  {
    path: ['plane', 'status', 'set'],
    summary: 'Set a Plane work item state',
    usage:
      'orca plane status set <id> --to <state-name-or-id> --project <id> [--workspace <id>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'to', 'project', 'workspace', 'id'],
    positionalArgs: ['id'],
    examples: ['orca plane status set PROJ-12 --to "In Review" --project <projectId> --json']
  },
  {
    path: ['plane', 'assignee', 'set'],
    summary: 'Assign a Plane work item',
    usage:
      'orca plane assignee set <id> (--me | --to-id <userId>) --project <id> [--workspace <id>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'me', 'to-id', 'project', 'workspace', 'id'],
    positionalArgs: ['id'],
    examples: ['orca plane assignee set PROJ-12 --me --project <projectId> --json']
  },
  {
    path: ['plane', 'assignee', 'clear'],
    summary: 'Clear a Plane work item assignee',
    usage: 'orca plane assignee clear <id> --project <id> [--workspace <id>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'project', 'workspace', 'id'],
    positionalArgs: ['id'],
    examples: ['orca plane assignee clear PROJ-12 --project <projectId> --json']
  },
  {
    path: ['plane', 'priority', 'set'],
    summary: 'Set a Plane work item priority',
    usage:
      'orca plane priority set <id> --to none|low|medium|high|urgent --project <id> [--workspace <id>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'to', 'project', 'workspace', 'id'],
    positionalArgs: ['id'],
    examples: ['orca plane priority set PROJ-12 --to high --project <projectId> --json']
  },
  {
    path: ['plane', 'priority', 'clear'],
    summary: 'Clear a Plane work item priority',
    usage: 'orca plane priority clear <id> --project <id> [--workspace <id>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'project', 'workspace', 'id'],
    positionalArgs: ['id'],
    examples: ['orca plane priority clear PROJ-12 --project <projectId> --json']
  },
  {
    path: ['plane', 'comment', 'add'],
    summary: 'Add a comment to a Plane work item',
    usage:
      'orca plane comment add <id> (--body <text> | --body-file <path|->) --project <id> [--workspace <id>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'body', 'body-file', 'project', 'workspace', 'id'],
    positionalArgs: ['id'],
    examples: [
      'orca plane comment add PROJ-12 --body "Ready for review." --project <projectId>',
      'orca plane comment add PROJ-12 --body-file - --project <projectId> --json'
    ],
    notes: ['Use --body-file - to read multiline comment bodies from stdin.']
  },
  {
    path: ['plane', 'project', 'list'],
    summary: 'List connected Plane projects',
    usage: 'orca plane project list [--workspace <id>|all] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'workspace'],
    examples: ['orca plane project list --workspace all --json']
  },
  {
    path: ['plane', 'states', 'list'],
    summary: 'List Plane project states',
    usage: 'orca plane states list --project <id> [--workspace <id>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'project', 'workspace'],
    examples: ['orca plane states list --project <projectId> --json']
  },
  {
    path: ['plane', 'states', 'create'],
    summary: 'Create a Plane project state (board column)',
    usage:
      'orca plane states create --project <id> --name <name> --group backlog|unstarted|started|completed|cancelled [--color <hex>] [--workspace <id>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'project', 'name', 'group', 'color', 'workspace'],
    examples: [
      'orca plane states create --project <projectId> --name "In Review" --group started --json'
    ]
  },
  {
    path: ['plane', 'states', 'rename'],
    summary: 'Rename or recolor a Plane project state',
    usage:
      'orca plane states rename --project <id> --state <stateId> --name <name> [--color <hex>] [--workspace <id>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'project', 'state', 'name', 'color', 'workspace'],
    examples: [
      'orca plane states rename --project <projectId> --state <stateId> --name "QA" --json'
    ]
  },
  {
    path: ['plane', 'labels', 'list'],
    summary: 'List Plane project labels',
    usage: 'orca plane labels list --project <id> [--workspace <id>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'project', 'workspace'],
    examples: ['orca plane labels list --project <projectId> --json']
  },
  {
    path: ['plane', 'members', 'list'],
    summary: 'List Plane workspace or project members',
    usage: 'orca plane members list [--project <id>] [--workspace <id>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'project', 'workspace'],
    examples: ['orca plane members list --project <projectId> --json']
  },
  {
    path: ['plane', 'save-issue'],
    summary: 'Update Plane work item fields in one partial write',
    usage:
      'orca plane save-issue <id> --project <id> [--title <title>] [--state <state>] [--assignee me|<userId>|null] [--priority none|low|medium|high|urgent] [--label <labelId>]... [--workspace <id>] [--json]',
    allowedFlags: [
      ...GLOBAL_FLAGS,
      'project',
      'title',
      'state',
      'assignee',
      'priority',
      'label',
      'workspace',
      'id'
    ],
    positionalArgs: ['id'],
    examples: [
      'orca plane save-issue PROJ-12 --project <projectId> --state "In Review" --assignee me --json'
    ],
    notes: ['Repeated --label replaces the full label set with the provided label ids.']
  }
]
