import type { CommandSpec } from '../args'
import { GLOBAL_FLAGS } from '../args'
import { PLANE_EXTENDED_COMMAND_SPECS } from './plane-extended'
import { PLANE_PLANNING_COMMAND_SPECS } from './plane-planning'
import { PLANE_PROJECT_COMMAND_SPECS } from './plane-project'

const PLANE_BASE_COMMAND_SPECS: CommandSpec[] = [
  {
    path: ['plane', 'create'],
    summary: 'Create a Plane work item',
    usage:
      'orca plane create --project <id> --title <title> [--body <text> | --body-file <path|->] [--state <name-or-id>] [--assignee me|<userId>] [--priority none|low|medium|high|urgent] [--label <labelId>]... [--parent <id>] [--start-date <YYYY-MM-DD>] [--target-date <YYYY-MM-DD>] [--workspace <id>] [--json]',
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
      'parent',
      'start-date',
      'target-date',
      'workspace'
    ],
    examples: [
      'orca plane create --project <projectId> --title "Investigate flaky login" --json',
      'orca plane create --project <projectId> --title "Follow-up" --assignee me --body-file - --json'
    ],
    notes: [
      'Use --body-file - to read a multiline description from stdin.',
      'Repeated --label sets the label set from the provided label ids.',
      '--parent takes a work item id/identifier and nests the new item under it.'
    ]
  },
  {
    path: ['plane', 'issue'],
    summary: 'Read Plane work item context for agents',
    usage:
      'orca plane issue [<id>] [--current] [--comments] [--children] [--project <id>] [--workspace <id>] [--json]',
    allowedFlags: [
      ...GLOBAL_FLAGS,
      'current',
      'comments',
      'children',
      'project',
      'workspace',
      'id'
    ],
    positionalArgs: ['id'],
    examples: [
      'orca plane issue PROJ-12 --json',
      'orca plane issue --current --json',
      'orca plane issue PROJ-12 --comments --project <projectId> --json',
      'orca plane issue ORCA-25 --children --project <projectId> --json'
    ],
    notes: [
      'Pass --current instead of an id to target the Plane work item linked to the current Orca worktree.'
    ]
  },
  {
    path: ['plane', 'link'],
    summary: 'Link the current Orca worktree to a Plane work item',
    usage: 'orca plane link <id> --project <id> [--workspace <id>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'project', 'workspace', 'id'],
    positionalArgs: ['id'],
    examples: [
      'orca plane link PROJ-12 --project <projectId> --json',
      'orca plane link 6f1c… --project <projectId> --workspace <id> --json'
    ],
    notes: [
      'Attaches a Plane work item to the worktree you run this from, so later commands accept --current.',
      'Use this for worktrees not created from a Plane task; run from inside the target worktree.'
    ]
  },
  {
    path: ['plane', 'unlink'],
    summary: 'Clear the Plane work item link on the current worktree',
    usage: 'orca plane unlink [--json]',
    allowedFlags: [...GLOBAL_FLAGS],
    examples: ['orca plane unlink --json'],
    notes: ['Removes only the Plane link; other worktree links are left untouched.']
  },
  {
    path: ['plane', 'list'],
    summary: 'List Plane work items for task triage',
    usage:
      'orca plane list [--filter everything|assigned|created|all|done] [--state <name>] [--priority none|low|medium|high|urgent] [--project <id>] [--limit <n>] [--workspace <id>|all] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'filter', 'state', 'priority', 'project', 'limit', 'workspace'],
    examples: [
      'orca plane list --filter assigned --limit 10 --json',
      'orca plane list --filter everything --state "In Progress" --priority high --json'
    ]
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
      'orca plane status set [<id>] [--current] --to <state-name-or-id> [--project <id>] [--workspace <id>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'current', 'to', 'project', 'workspace', 'id'],
    positionalArgs: ['id'],
    examples: [
      'orca plane status set PROJ-12 --to "In Review" --project <projectId> --json',
      'orca plane status set --current --to "In Review" --json'
    ],
    notes: [
      'Pass --current instead of <id> --project to target the work item linked to the current worktree.'
    ]
  },
  {
    path: ['plane', 'assignee', 'set'],
    summary: 'Assign a Plane work item',
    usage:
      'orca plane assignee set [<id>] [--current] (--me | --to-id <userId>) [--project <id>] [--workspace <id>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'current', 'me', 'to-id', 'project', 'workspace', 'id'],
    positionalArgs: ['id'],
    examples: [
      'orca plane assignee set PROJ-12 --me --project <projectId> --json',
      'orca plane assignee set --current --me --json'
    ]
  },
  {
    path: ['plane', 'assignee', 'clear'],
    summary: 'Clear a Plane work item assignee',
    usage:
      'orca plane assignee clear [<id>] [--current] [--project <id>] [--workspace <id>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'current', 'project', 'workspace', 'id'],
    positionalArgs: ['id'],
    examples: [
      'orca plane assignee clear PROJ-12 --project <projectId> --json',
      'orca plane assignee clear --current --json'
    ]
  },
  {
    path: ['plane', 'priority', 'set'],
    summary: 'Set a Plane work item priority',
    usage:
      'orca plane priority set [<id>] [--current] --to none|low|medium|high|urgent [--project <id>] [--workspace <id>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'current', 'to', 'project', 'workspace', 'id'],
    positionalArgs: ['id'],
    examples: [
      'orca plane priority set PROJ-12 --to high --project <projectId> --json',
      'orca plane priority set --current --to high --json'
    ]
  },
  {
    path: ['plane', 'priority', 'clear'],
    summary: 'Clear a Plane work item priority',
    usage:
      'orca plane priority clear [<id>] [--current] [--project <id>] [--workspace <id>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'current', 'project', 'workspace', 'id'],
    positionalArgs: ['id'],
    examples: [
      'orca plane priority clear PROJ-12 --project <projectId> --json',
      'orca plane priority clear --current --json'
    ]
  },
  {
    path: ['plane', 'comment', 'add'],
    summary: 'Add a comment to a Plane work item',
    usage:
      'orca plane comment add [<id>] [--current] (--body <text> | --body-file <path|->) [--project <id>] [--workspace <id>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'current', 'body', 'body-file', 'project', 'workspace', 'id'],
    positionalArgs: ['id'],
    examples: [
      'orca plane comment add PROJ-12 --body "Ready for review." --project <projectId>',
      'orca plane comment add --current --body "Ready for review." --json',
      'orca plane comment add PROJ-12 --body-file - --project <projectId> --json'
    ],
    notes: ['Use --body-file - to read multiline comment bodies from stdin.']
  },
  {
    path: ['plane', 'comment', 'delete'],
    aliases: [['plane', 'comment', 'rm']],
    summary: 'Delete a comment from a Plane work item',
    usage:
      'orca plane comment delete <commentId> ([<workItemId>] | --current) --project <id> [--workspace <id>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'current', 'project', 'workspace', 'id', 'commentId'],
    positionalArgs: ['commentId', 'id'],
    destructive: true,
    examples: [
      'orca plane comment delete <commentId> PROJ-12 --project <projectId> --json',
      'orca plane comment delete <commentId> --current --json'
    ],
    notes: [
      'Pass --current instead of <workItemId> --project to target the work item linked to the current worktree.'
    ]
  },
  {
    path: ['plane', 'project', 'list'],
    summary: 'List connected Plane projects across every connected workspace',
    usage: 'orca plane project list [--workspace <id>|all] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'workspace'],
    examples: [
      'orca plane project list --json',
      'orca plane project list --workspace <workspaceId> --json'
    ],
    notes: [
      'With no --workspace, lists every connected workspace grouped by workspace (same as --workspace all) — the result never depends on which workspace is selected in the app.',
      'Pass --workspace <id> to scope the list to one workspace. Each project carries its workspaceId and workspaceSlug in --json.'
    ]
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
      'orca plane save-issue [<id>] [--current] [--project <id>] [--title <title>] [--body <text> | --body-file <path|->] [--state <state>] [--assignee me|<userId>|null] [--priority none|low|medium|high|urgent] [--label <labelId>]... [--parent <id>|null] [--start-date <YYYY-MM-DD>] [--target-date <YYYY-MM-DD>] [--workspace <id>] [--json]',
    allowedFlags: [
      ...GLOBAL_FLAGS,
      'current',
      'project',
      'title',
      'body',
      'body-file',
      'state',
      'assignee',
      'priority',
      'label',
      'parent',
      'start-date',
      'target-date',
      'workspace',
      'id'
    ],
    positionalArgs: ['id'],
    examples: [
      'orca plane save-issue PROJ-12 --project <projectId> --state "In Review" --assignee me --json',
      'orca plane save-issue --current --state "In Review" --assignee me --json'
    ],
    notes: [
      'Repeated --label replaces the full label set with the provided label ids.',
      '--body/--body-file set the description (Markdown; --body-file - reads stdin).',
      '--parent takes a work item id/identifier; pass --parent null to clear it.',
      'Pass --current instead of <id> --project to target the work item linked to the current worktree.'
    ]
  }
]

export const PLANE_COMMAND_SPECS: CommandSpec[] = [
  ...PLANE_BASE_COMMAND_SPECS,
  ...PLANE_EXTENDED_COMMAND_SPECS,
  ...PLANE_PLANNING_COMMAND_SPECS,
  ...PLANE_PROJECT_COMMAND_SPECS
]
