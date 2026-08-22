import { Columns3, LayoutGrid, Orbit } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { translate } from '@/i18n/i18n'
import type { AgentDashboardView } from './agent-dashboard-view'

type ToggleOption = {
  view: AgentDashboardView
  Icon: typeof Columns3
  labelKey: string
  labelFallback: string
}

const OPTIONS: readonly ToggleOption[] = [
  { view: 'grid', Icon: LayoutGrid, labelKey: 'dashboardPopout.view.grid', labelFallback: 'Grid' },
  {
    view: 'board',
    Icon: Columns3,
    labelKey: 'dashboardPopout.view.board',
    labelFallback: 'Dashboard'
  },
  { view: 'map', Icon: Orbit, labelKey: 'dashboardPopout.view.map', labelFallback: 'Agent Map' }
]

export function AgentDashboardViewToggle({
  view,
  onViewChange
}: {
  view: AgentDashboardView
  onViewChange: (view: AgentDashboardView) => void
}): React.JSX.Element {
  return (
    <div
      className="flex items-center gap-0.5 rounded-md border border-border p-0.5"
      role="group"
      aria-label={translate('dashboardPopout.view.label', 'Dashboard view')}
    >
      {OPTIONS.map(({ view: option, Icon, labelKey, labelFallback }) => (
        <Button
          key={option}
          type="button"
          variant="ghost"
          size="xs"
          aria-pressed={view === option}
          className={cn('h-6 gap-1 px-2', view === option && 'bg-accent')}
          onClick={() => onViewChange(option)}
        >
          <Icon className="size-3" />
          {translate(labelKey, labelFallback)}
        </Button>
      ))}
    </div>
  )
}
