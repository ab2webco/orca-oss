import type { HandlerGroup } from './handler-group-manifest'

// Why split out: the lab-only Plane surface is the fork's largest command group
// and changes as a unit, so it keeps handler-group-manifest.ts inside the
// max-lines cap and readable at a glance. It routes through the same lazy
// manifest, so a CLI invocation that never touches Plane never loads its module
// graph either.
export const PLANE_HANDLER_GROUPS: readonly HandlerGroup[] = [
  {
    name: 'plane',
    keys: [
      'plane create',
      'plane link',
      'plane unlink',
      'plane save-issue',
      'plane issue',
      'plane list',
      'plane search',
      'plane status set',
      'plane assignee set',
      'plane assignee clear',
      'plane priority set',
      'plane priority clear',
      'plane comment add',
      'plane comment delete',
      'plane project list',
      'plane states list',
      'plane states create',
      'plane states rename',
      'plane labels list',
      'plane members list'
    ],
    load: async () => (await import('./handlers/plane.js')).PLANE_HANDLERS
  },
  {
    name: 'plane-delete-archive',
    keys: ['plane delete', 'plane states delete'],
    load: async () =>
      (await import('./handlers/plane-delete-archive.js')).PLANE_DELETE_ARCHIVE_HANDLERS
  },
  {
    name: 'plane-project',
    keys: [
      'plane project create',
      'plane project update',
      'plane project archive',
      'plane project unarchive'
    ],
    load: async () => (await import('./handlers/plane-project.js')).PLANE_PROJECT_HANDLERS
  },
  {
    name: 'plane-relation',
    keys: ['plane relation add', 'plane relation list'],
    load: async () => (await import('./handlers/plane-relation.js')).PLANE_RELATION_HANDLERS
  },
  {
    name: 'plane-attach',
    keys: ['plane attach add', 'plane attach upload', 'plane attach list', 'plane attach remove'],
    load: async () => (await import('./handlers/plane-attach.js')).PLANE_ATTACH_HANDLERS
  },
  {
    name: 'plane-label',
    keys: ['plane label create', 'plane label add', 'plane label remove'],
    load: async () => (await import('./handlers/plane-label.js')).PLANE_LABEL_HANDLERS
  },
  {
    name: 'plane-comment-list',
    keys: ['plane comment list'],
    load: async () => (await import('./handlers/plane-comment-list.js')).PLANE_COMMENT_LIST_HANDLERS
  },
  {
    name: 'plane-planning',
    keys: [
      'plane cycle list',
      'plane cycle issues',
      'plane cycle add-items',
      'plane module list',
      'plane module issues',
      'plane module add-items'
    ],
    load: async () => (await import('./handlers/plane-planning.js')).PLANE_PLANNING_HANDLERS
  }
]
