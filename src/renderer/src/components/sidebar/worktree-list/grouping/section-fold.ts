import type { Repo } from '../../../../../../shared/repo-types'
import { resolveIdleProjectFold } from './idle-project-fold'
import type { WorktreeGroupEntry } from './project-grouping'
import type {
  IdleProjectFold,
  ImportedWorktreesCardCandidate,
  NewExternalWorktreesInboxCandidate,
  PendingCreationRef,
  WorktreeGroupBy
} from './row-types'

/** What the idle-project fold reads from section emission; its own module so urgency can share it. */
export type SectionFoldInputs = {
  groupBy: WorktreeGroupBy
  collapsedGroups: Set<string>
  importedWorktreesByRepo: ReadonlyMap<string, ImportedWorktreesCardCandidate>
  newExternalWorktreesInboxByRepo: ReadonlyMap<string, NewExternalWorktreesInboxCandidate>
  pendingByRepo: ReadonlyMap<string, PendingCreationRef[]>
  activeProjectKeys?: ReadonlySet<string>
}

export function getSectionRepoIds(
  key: string,
  repoIds: ReadonlySet<string>,
  repo?: Repo
): string[] {
  if (repoIds.size > 0) {
    return [...repoIds]
  }
  if (repo) {
    return [repo.id]
  }
  return key.startsWith('repo:') ? [key.slice('repo:'.length)] : []
}

export function resolveSectionFold(
  ctx: SectionFoldInputs,
  key: string,
  group: WorktreeGroupEntry
): IdleProjectFold | undefined {
  const { groupBy, activeProjectKeys, collapsedGroups } = ctx
  // Why repo-gated: SectionHeader draws the fold only on a project header that knows its repo.
  if (groupBy !== 'repo' || !group.repo || !activeProjectKeys) {
    return undefined
  }
  const repoIds = getSectionRepoIds(key, group.repoIds, group.repo)
  return resolveIdleProjectFold({
    key,
    items: group.items,
    activeProjectKeys,
    collapsedGroups,
    hasProjectNotice: repoIds.some(
      (repoId) =>
        ctx.importedWorktreesByRepo.has(repoId) ||
        ctx.newExternalWorktreesInboxByRepo.has(repoId) ||
        (ctx.pendingByRepo.get(repoId)?.length ?? 0) > 0
    )
  })
}
