import {
  Activity,
  ArrowRight,
  ArrowUpFromLine,
  Check,
  FlaskConical,
  GitPullRequest,
  List,
  Play,
  Search,
  Square,
  Tag,
  type LucideIcon
} from 'lucide-react'
import { cn } from '@/lib/utils'
import type { GameActionIcon } from '../../../../shared/orchestrator-game-actions'

/** Prototype V30's action glyphs, as the closest lucide icons. */
export const TEAM_ACTION_ICONS: Record<GameActionIcon, LucideIcon> = {
  ship: ArrowUpFromLine,
  flask: FlaskConical,
  tag: Tag,
  review: GitPullRequest,
  scan: Search,
  list: List,
  pulse: Activity,
  launch: ArrowRight,
  play: Play,
  check: Check,
  stop: Square
}

export function TeamActionIcon({
  icon,
  className
}: {
  icon: GameActionIcon | null
  className?: string
}): React.JSX.Element {
  // Why pulse: V30 draws an action without an icon with it.
  const Icon = TEAM_ACTION_ICONS[icon ?? 'pulse']
  return <Icon aria-hidden className={cn('size-3.5 shrink-0', className)} />
}
