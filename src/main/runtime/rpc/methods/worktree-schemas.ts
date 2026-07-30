import { z } from 'zod'
import { RUNTIME_NAVIGATION_TARGETS } from '../../../../shared/runtime-navigation'
import {
  OptionalBoolean,
  OptionalFiniteNumber,
  OptionalPlainString,
  OptionalString,
  TriStateLinkedIssue
} from '../schemas'
import { TaskSourceContextSchema } from '../../../../shared/task-source-context-schema'
import { WorkspaceLinkedItemSchema } from '../../../../shared/workspace-linked-item-schema'
import {
  assertLinkedWorkItemSourceContextMatch,
  LinkedPlaneWorkItemSchema
} from './worktree-linked-item-schemas'

export { WorktreeCreate, WorktreePrefetchCreateBase } from './worktree-create-schemas'

export const WorktreeListParams = z.object({
  repo: OptionalString,
  limit: OptionalFiniteNumber
})

export const WorktreeDetectedListParams = z.object({
  repo: z
    .unknown()
    .transform((v) => (typeof v === 'string' ? v : ''))
    .pipe(z.string().min(1, 'Missing repo selector'))
})

export const WorktreeTeardownMissingTerminalsParams = WorktreeDetectedListParams.extend({
  worktreeIds: z.array(z.string().min(1)).max(10_000),
  connectionId: z.string().nullable().optional()
})

export const WorktreePsParams = z.object({
  limit: OptionalFiniteNumber
})

export const WorktreeSortOrder = z.object({
  orderedIds: z.array(z.string())
})

export const WorktreeSelector = z.object({
  worktree: z
    .unknown()
    .transform((v) => (typeof v === 'string' ? v : ''))
    .pipe(z.string().min(1, 'Missing worktree selector'))
})

export const WorktreeActivate = WorktreeSelector.extend({
  notifyClients: OptionalBoolean,
  navigation: z.enum(RUNTIME_NAVIGATION_TARGETS).optional()
})

const WorktreeMetaSet = WorktreeSelector.extend({
  // Why: '' is the blanking contract — "fall back to the branch/folder name".
  // OptionalString coerced it to undefined, so on remote/SSH hosts clearing the
  // name was dropped here and the old name came back on the next refresh. Lives on
  // the shared base so the batch path gets the same contract.
  displayName: OptionalPlainString,
  // Why: empty comments are meaningful metadata updates, so use the plain
  // string parser instead of OptionalString's empty-as-undefined behavior.
  comment: OptionalPlainString,
  linkedIssue: TriStateLinkedIssue,
  linkedPR: TriStateLinkedIssue,
  linkedLinearIssue: z.union([z.string(), z.null()]).optional(),
  linkedLinearIssueWorkspaceId: z.union([z.string(), z.null()]).optional(),
  linkedLinearIssueOrganizationUrlKey: z.union([z.string(), z.null()]).optional(),
  linkedPlaneWorkItem: LinkedPlaneWorkItemSchema,
  linkedGitLabMR: TriStateLinkedIssue,
  linkedGitLabIssue: TriStateLinkedIssue,
  linkedBitbucketPR: TriStateLinkedIssue,
  linkedAzureDevOpsPR: TriStateLinkedIssue,
  linkedGiteaPR: TriStateLinkedIssue,
  linkedWorkItem: WorkspaceLinkedItemSchema.nullable().optional(),
  linkedTaskSourceContext: TaskSourceContextSchema.nullable().optional(),
  isArchived: OptionalBoolean,
  isUnread: OptionalBoolean,
  isPinned: OptionalBoolean,
  sortOrder: OptionalFiniteNumber,
  manualOrder: OptionalFiniteNumber,
  lastActivityAt: OptionalFiniteNumber,
  createdAt: OptionalFiniteNumber,
  sparseDirectories: z.array(z.string()).optional(),
  sparseBaseRef: OptionalString,
  sparsePresetId: OptionalString,
  baseRef: OptionalString,
  workspaceStatus: OptionalString,
  claudeAccountId: z.union([z.string().min(1).max(512), z.null()]).optional(),
  codexAccountId: z.union([z.string().min(1).max(512), z.null()]).optional(),
  pushTarget: z
    .object({
      remoteName: z.string(),
      branchName: z.string(),
      remoteUrl: OptionalString
    })
    .nullable()
    .optional(),
  diffComments: z.array(z.unknown()).optional(),
  mobileDiffReview: z.unknown().optional()
})

export const WorktreeSet = WorktreeMetaSet.extend({
  parentWorktree: OptionalString,
  noParent: OptionalBoolean
}).superRefine((params, ctx) => {
  assertLinkedWorkItemSourceContextMatch(params, ctx)
  if (params.parentWorktree && params.noParent === true) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Choose either --parent-worktree or --no-parent, not both.'
    })
  }
})

export const WorktreeSetBatch = z.object({
  updates: z.array(WorktreeMetaSet).min(1).max(500)
})

export const WorktreeRemove = WorktreeSelector.extend({
  force: OptionalBoolean,
  runHooks: OptionalBoolean
})

export const WorktreeForceDeleteBranch = WorktreeSelector.extend({
  branchName: z
    .unknown()
    .transform((v) => (typeof v === 'string' ? v : ''))
    .pipe(z.string().min(1, 'Missing branch name')),
  expectedHead: z
    .unknown()
    .transform((v) => (typeof v === 'string' ? v : ''))
    .pipe(z.string().min(1, 'Missing expected branch head'))
})

export const WorktreeResolvePrBase = z.object({
  repo: z
    .unknown()
    .transform((v) => (typeof v === 'string' ? v : ''))
    .pipe(z.string().min(1, 'Missing repo selector')),
  prNumber: z
    .unknown()
    .transform((v) => (typeof v === 'number' && Number.isFinite(v) ? v : 0))
    .pipe(z.number().int().positive('Missing PR number')),
  headRefName: OptionalString,
  baseRefName: OptionalString,
  isCrossRepository: OptionalBoolean
})

export const WorktreeResolveMrBase = z.object({
  repo: z
    .unknown()
    .transform((v) => (typeof v === 'string' ? v : ''))
    .pipe(z.string().min(1, 'Missing repo selector')),
  mrIid: z
    .unknown()
    .transform((v) => (typeof v === 'number' && Number.isFinite(v) ? v : 0))
    .pipe(z.number().int().positive('Missing MR number')),
  sourceBranch: OptionalString,
  targetBranch: OptionalString,
  isCrossRepository: OptionalBoolean
})
