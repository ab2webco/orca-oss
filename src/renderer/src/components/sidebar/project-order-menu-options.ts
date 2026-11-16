import { ArrowDownAZ, BellDot, Clock, GripVertical } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { translate } from '@/i18n/i18n'
import { getDefaultUIState } from '../../../../shared/constants'
import type { ProjectOrderBy } from '../../../../shared/ui-chrome-types'

type ProjectOrderMenuOption = {
  id: ProjectOrderBy
  /** Shown in the check's place when the option is not the selected one. */
  icon: LucideIcon
  readonly label: string
}

export const PROJECT_ORDER_MENU_OPTIONS: readonly ProjectOrderMenuOption[] = [
  {
    id: 'needs-you',
    icon: BellDot,
    get label() {
      return translate(
        'auto.components.sidebar.SidebarProjectOrderMenu.needsYouFirst',
        'Needs you first'
      )
    }
  },
  {
    id: 'recent',
    icon: Clock,
    get label() {
      return translate('auto.components.sidebar.SidebarProjectOrderMenu.recent', 'Recent activity')
    }
  },
  {
    id: 'name',
    icon: ArrowDownAZ,
    get label() {
      return translate('auto.components.sidebar.SidebarProjectOrderMenu.name', 'Name')
    }
  },
  {
    id: 'manual',
    icon: GripVertical,
    get label() {
      return translate('auto.components.sidebar.SidebarProjectOrderMenu.manual', 'Manual (drag)')
    }
  }
]

export function isProjectOrderOffDefault(projectOrderBy: ProjectOrderBy): boolean {
  return projectOrderBy !== getDefaultUIState().projectOrderBy
}
