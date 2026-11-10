import { DEFAULT_REPO_BADGE_COLOR, REPO_COLORS } from '../../../../shared/constants'
import { normalizeRepoBadgeColor } from '../../../../shared/repo-badge-color'

export function resolveRepoHeaderColor(badgeColor: string | null | undefined): string {
  const normalizedBadgeColor = normalizeRepoBadgeColor(badgeColor)
  if (!normalizedBadgeColor) {
    return DEFAULT_REPO_BADGE_COLOR
  }

  // Why: persisted repo colors are rendered as inline CSS here, so only
  // normalized hex values from the palette or custom picker reach the sidebar.
  return REPO_COLORS.find((repoColor) => repoColor === normalizedBadgeColor) ?? normalizedBadgeColor
}
