import type { CommandSpec } from '../args'
import { GLOBAL_FLAGS } from '../args'

// Extended Plane command specs (delete/archive, states delete, relations,
// attach links, labels, comment list). Split from plane.ts so both stay under
// the per-file line cap; concatenated into PLANE_COMMAND_SPECS there.
export const PLANE_EXTENDED_COMMAND_SPECS: CommandSpec[] = [
  {
    path: ['plane', 'delete'],
    aliases: [['plane', 'rm']],
    summary: 'Delete a Plane work item',
    usage: 'orca plane delete <id> --project <id> [--workspace <id>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'project', 'workspace', 'id'],
    positionalArgs: ['id'],
    destructive: true,
    examples: ['orca plane delete PROJ-12 --project <projectId> --json'],
    notes: ['Deletion cannot be undone; resolve the id to its work item first with issue.']
  },
  {
    path: ['plane', 'states', 'delete'],
    aliases: [['plane', 'states', 'rm']],
    summary: 'Delete a Plane project state (board column)',
    usage: 'orca plane states delete <stateId> --project <id> [--workspace <id>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'project', 'workspace', 'stateId'],
    positionalArgs: ['stateId'],
    destructive: true,
    examples: ['orca plane states delete <stateId> --project <projectId> --json'],
    notes: ['Plane rejects deleting a state that still has work items or the default state.']
  },
  {
    path: ['plane', 'relation', 'add'],
    summary: 'Add a relation between two Plane work items',
    usage:
      'orca plane relation add <id> --related <id> --type blocks|blocked-by|related|duplicate --project <id> [--workspace <id>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'related', 'type', 'project', 'workspace', 'id'],
    positionalArgs: ['id'],
    examples: [
      'orca plane relation add PROJ-12 --related PROJ-15 --type blocks --project <projectId> --json'
    ],
    notes: ['Both <id> and --related accept an identifier or UUID; both resolve to UUIDs.']
  },
  {
    path: ['plane', 'relation', 'list'],
    summary: 'List a Plane work item relations',
    usage: 'orca plane relation list <id> --project <id> [--workspace <id>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'project', 'workspace', 'id'],
    positionalArgs: ['id'],
    examples: ['orca plane relation list PROJ-12 --project <projectId> --json']
  },
  {
    path: ['plane', 'attach', 'add'],
    summary: 'Attach a URL link to a Plane work item',
    usage:
      'orca plane attach add <id> --url <url> [--title <t>] --project <id> [--workspace <id>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'url', 'title', 'project', 'workspace', 'id'],
    positionalArgs: ['id'],
    examples: [
      'orca plane attach add PROJ-12 --url https://example.com --title Docs --project <projectId> --json'
    ]
  },
  {
    path: ['plane', 'attach', 'upload'],
    summary: 'Upload a local file as a Plane work item attachment',
    usage: 'orca plane attach upload <id> --file <path> --project <id> [--workspace <id>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'file', 'project', 'workspace', 'id'],
    positionalArgs: ['id'],
    examples: [
      'orca plane attach upload PROJ-12 --file ./qa-video.mp4 --project <projectId> --json'
    ],
    notes: [
      'Three-step upload: Plane issues a signed URL, the file goes straight to storage, then the asset is confirmed.',
      'The file is read by the Orca app host; not supported over a remote pairing. For URL links use attach add.'
    ]
  },
  {
    path: ['plane', 'attach', 'list'],
    summary: 'List URL links and uploaded file attachments on a Plane work item',
    usage: 'orca plane attach list <id> --project <id> [--workspace <id>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'project', 'workspace', 'id'],
    positionalArgs: ['id'],
    examples: ['orca plane attach list PROJ-12 --project <projectId> --json'],
    notes: [
      'JSON result is { links, attachments }; links and uploaded files are listed separately.'
    ]
  },
  {
    path: ['plane', 'attach', 'remove'],
    aliases: [['plane', 'attach', 'rm']],
    summary: 'Remove a URL link from a Plane work item',
    usage:
      'orca plane attach remove <id> --link <linkId> --project <id> [--workspace <id>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'link', 'project', 'workspace', 'id'],
    positionalArgs: ['id'],
    destructive: true,
    examples: ['orca plane attach remove PROJ-12 --link <linkId> --project <projectId> --json']
  },
  {
    path: ['plane', 'label', 'create'],
    summary: 'Create a Plane project label',
    usage:
      'orca plane label create --project <id> --name <name> [--color <hex>] [--workspace <id>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'project', 'name', 'color', 'workspace'],
    examples: ['orca plane label create --project <projectId> --name Bug --color "#ef4444" --json']
  },
  {
    path: ['plane', 'label', 'add'],
    summary: 'Add labels to a Plane work item',
    usage:
      'orca plane label add <id> --label <labelId>... --project <id> [--workspace <id>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'label', 'project', 'workspace', 'id'],
    positionalArgs: ['id'],
    examples: ['orca plane label add PROJ-12 --label <labelId> --project <projectId> --json'],
    notes: ['Repeated --label adds each id to the work item current label set.']
  },
  {
    path: ['plane', 'label', 'remove'],
    aliases: [['plane', 'label', 'rm']],
    summary: 'Remove labels from a Plane work item',
    usage:
      'orca plane label remove <id> --label <labelId>... --project <id> [--workspace <id>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'label', 'project', 'workspace', 'id'],
    positionalArgs: ['id'],
    examples: ['orca plane label remove PROJ-12 --label <labelId> --project <projectId> --json'],
    notes: ['Repeated --label removes each id from the work item current label set.']
  },
  {
    path: ['plane', 'comment', 'list'],
    summary: 'List comments on a Plane work item',
    usage: 'orca plane comment list <id> --project <id> [--workspace <id>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'project', 'workspace', 'id'],
    positionalArgs: ['id'],
    examples: ['orca plane comment list PROJ-12 --project <projectId> --json']
  }
]
