import React from 'react'
import { TriangleAlert, X } from 'lucide-react'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { translate } from '@/i18n/i18n'

export function AutomationListStatusCell({
  enabled,
  blockedMessage = null
}: {
  enabled: boolean
  /** Por que esta fila encendida no puede lanzar. `null` = puede. */
  blockedMessage?: string | null
}): React.JSX.Element {
  if (enabled && blockedMessage) {
    // Encendida pero sin destino que resuelva: cada corrida termina en
    // `skipped_unavailable`. Decirlo aca y no solo en el historial es la
    // diferencia entre enterarse hoy y enterarse a las 76 corridas.
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="inline-flex min-w-0 items-center gap-1 truncate text-destructive">
            <TriangleAlert className="size-3.5 shrink-0" />
            <span className="min-w-0 truncate">
              {translate(
                'auto.components.automations.AutomationListStatusCell.willNotRun',
                'Will not run'
              )}
            </span>
          </span>
        </TooltipTrigger>
        <TooltipContent side="top" sideOffset={4}>
          {blockedMessage}
        </TooltipContent>
      </Tooltip>
    )
  }
  if (enabled) {
    return (
      <span className="inline-flex min-w-0 items-center gap-1 truncate text-muted-foreground">
        <span className="size-1.5 shrink-0 rounded-full bg-foreground" />
        {translate('auto.components.automations.AutomationDetail.eaa02014f8', 'Enabled')}
      </span>
    )
  }
  return (
    <span className="inline-flex min-w-0 items-center gap-1 truncate text-muted-foreground">
      <X className="size-3.5 shrink-0" />
      {translate('auto.components.automations.AutomationDetail.b09b2384fd', 'Paused')}
    </span>
  )
}
