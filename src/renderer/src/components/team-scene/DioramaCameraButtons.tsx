import React from 'react'
import type { DioramaCameraMode } from './team-diorama-view'
import { Button } from '@/components/ui/button'
import { translate } from '@/i18n/i18n'

/** Follow the lead or Show all, over a 3D scene's corner: Figures' diorama and the 3D Office. */
export function DioramaCameraButtons({
  mode,
  setMode
}: {
  mode: DioramaCameraMode
  setMode: (mode: DioramaCameraMode) => void
}): React.JSX.Element {
  const modes = [
    [
      'lead',
      translate('auto.components.team-scene.TeamSceneDiorama.followLead', 'Follow the lead')
    ],
    ['all', translate('auto.components.team-scene.TeamSceneDiorama.showAll', 'Show all')]
  ] as const
  return (
    <div className="absolute top-2 right-2 flex gap-1">
      {modes.map(([one, label]) => (
        <Button
          key={one}
          variant="outline"
          size="xs"
          aria-pressed={mode === one}
          className="aria-pressed:bg-accent"
          onClick={() => setMode(one)}
        >
          {label}
        </Button>
      ))}
    </div>
  )
}
