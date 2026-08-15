import type { GitHubProjectViewLayout } from './github-project-types'

export function isSupportedGitHubProjectViewLayout(layout: GitHubProjectViewLayout): boolean {
  return layout === 'TABLE_LAYOUT' || layout === 'BOARD_LAYOUT'
}
