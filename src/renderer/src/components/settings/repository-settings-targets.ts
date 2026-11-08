import type { SourceControlActionId } from '../../../../shared/source-control-ai-actions'

export function getRepositoryLocalCommandsSectionId(repoId: string): string {
  return `repo-${repoId}-local-commands`
}

export function getRepositoryIconSectionId(repoId: string): string {
  return `repo-${repoId}-icon`
}

export function getRepositorySourceControlAiSectionId(repoId: string): string {
  return `repo-${repoId}-source-control-ai`
}

export function getRepositorySourceControlAiActionRecipeSectionId(
  repoId: string,
  actionId: SourceControlActionId
): string {
  return `repo-${repoId}-source-control-ai-${actionId}`
}

export function getRepositoryGameSectionId(repoId: string): string {
  return `repo-${repoId}-game`
}

/** Settings > Actions inside the project's game section, which the dock's menu opens. */
export function getRepositoryGameActionsSectionId(repoId: string): string {
  return `repo-${repoId}-game-actions`
}

/** The global Panel section under Agents, which the panel gear opens with no team. */
export const GAME_PANEL_GLOBAL_SECTION_ID = 'agents-game-panel'
