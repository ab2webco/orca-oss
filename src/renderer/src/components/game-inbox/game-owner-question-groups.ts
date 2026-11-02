import { parseExecutionHostId } from '../../../../shared/execution-host'
import { getRepoIdFromWorktreeId } from '../../../../shared/worktree/id'
import type { GameOwnerQuestionProject } from '../../../../shared/orchestrator-game-owner-questions'
import type { GameOwnerQuestionHost } from './game-owner-questions-across-hosts'

export type GameOwnerQuestionGroup = {
  environmentId: string | null
  project: GameOwnerQuestionProject
}

/** The paired host a workspace runs on; null is this computer. */
export function environmentIdOfHost(hostId: string | null | undefined): string | null {
  const parsed = parseExecutionHostId(hostId)
  return parsed?.kind === 'runtime' ? parsed.environmentId : null
}

export function isActiveGameProject(
  group: GameOwnerQuestionGroup,
  active: { worktreeId: string | null; environmentId: string | null }
): boolean {
  return (
    active.worktreeId !== null &&
    group.environmentId === active.environmentId &&
    getRepoIdFromWorktreeId(active.worktreeId) === group.project.repoId
  )
}

/** Every project with open questions except the active one, which the Inbox reads on its own. */
export function otherGameOwnerQuestionGroups(
  hosts: readonly GameOwnerQuestionHost[],
  active: { worktreeId: string | null; environmentId: string | null }
): GameOwnerQuestionGroup[] {
  return hosts
    .flatMap((host) =>
      host.projects.map((project) => ({ environmentId: host.environmentId, project }))
    )
    .filter((group) => !isActiveGameProject(group, active))
}
