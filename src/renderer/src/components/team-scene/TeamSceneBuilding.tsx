import React, { useMemo, useState } from 'react'
import type { TeamPanelGameModel } from '../../../../shared/team-panel-model-types'
import {
  teamSceneFloorInputOf,
  teamSceneFloorsOf,
  type TeamSceneFloor
} from '../../../../shared/team-scene/team-scene-floors'
import { Button } from '@/components/ui/button'
import { translate } from '@/i18n/i18n'
import { teamHostText } from '../team-panel/team-card-text'
import { TeamSceneCanvas } from './TeamSceneCanvas'
import { teamSceneLabel } from './team-scene-copy'
import type { TeamScenePainter } from './team-scene-painter'

export type TeamSceneBuildingModel = Pick<
  TeamPanelGameModel,
  'lead' | 'advisor' | 'members' | 'machines' | 'queue' | 'stopped'
>

type Props = {
  model: TeamSceneBuildingModel
  /** A fresh painter per floor: each keeps its own effects and caches. */
  makePainter: () => TeamScenePainter | null
  leadLine: string | null
  onUnplaced?: (keys: string[]) => void
}

// Why these: a floor's strip is the row of desks, its sky cropped, so three floors fit a panel.
const STRIP = { height: 112, crop: 58 }
const SHOWN_FLOORS = 3

/** True when the team spans more than one machine: the building replaces the single office. */
export const teamSceneHasFloors = (model: TeamSceneBuildingModel): boolean =>
  teamSceneFloorsOf(model).length > 1

function FloorStage({
  model,
  floor,
  makePainter,
  leadLine,
  onUnplaced,
  zoomed
}: Props & { floor: TeamSceneFloor; zoomed: boolean }): React.JSX.Element | null {
  const painter = useMemo(makePainter, [makePainter])
  const input = useMemo(() => teamSceneFloorInputOf(model, floor), [model, floor])
  if (!painter) {
    return null
  }
  return (
    <div
      data-team-floor={floor.key}
      data-team-floor-dark={floor.reachable ? undefined : ''}
      className="relative overflow-hidden border-b border-border last:border-b-0"
      style={zoomed ? undefined : { height: STRIP.height }}
    >
      <div style={zoomed ? undefined : { marginTop: -STRIP.crop }}>
        <TeamSceneCanvas
          input={input}
          painter={painter}
          leadLine={floor.lead ? leadLine : null}
          onUnplaced={floor.lead ? onUnplaced : undefined}
        />
      </div>
      {/* Why no words: the dark floor and its members' static screens say it cannot be reached. */}
      {floor.reachable ? null : (
        <div className="pointer-events-none absolute inset-0 bg-scene-bubble/80" />
      )}
    </div>
  )
}

/** One floor per machine the team runs on; a button or a number key zooms into one. */
export function TeamSceneBuilding(props: Props): React.JSX.Element {
  const floors = useMemo(() => teamSceneFloorsOf(props.model), [props.model])
  const [zoom, setZoom] = useState<string | null>(null)
  const zoomed = floors.find((floor) => floor.key === zoom) ?? null
  // Why the lead's at the bottom: floor 1 is where the lead stands, the others above it.
  const shown = zoomed ? [zoomed] : floors.slice(0, SHOWN_FLOORS).toReversed()
  const more = zoomed ? 0 : floors.length - SHOWN_FLOORS
  const onKeyDown = (event: React.KeyboardEvent): void => {
    if (event.key === 'Escape' || event.key === '0') {
      setZoom(null)
      event.preventDefault()
      return
    }
    const floor = /^[1-9]$/.test(event.key) ? floors[Number(event.key) - 1] : undefined
    if (floor) {
      setZoom(floor.key)
      event.preventDefault()
    }
  }
  return (
    <div
      data-team-building=""
      role="group"
      aria-label={teamSceneLabel()}
      tabIndex={0}
      onKeyDown={onKeyDown}
      className="flex flex-col outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      {/* Why a row on top: a side column took half the stage at 320 and crowded every desk. */}
      <nav className="flex flex-wrap gap-1 border-b border-border p-1">
        <Button
          size="xs"
          variant={zoomed ? 'ghost' : 'secondary'}
          aria-pressed={zoomed === null}
          onClick={() => setZoom(null)}
        >
          {translate('teamPanel.machines.all', 'All')}
        </Button>
        {floors.map((floor) => (
          <Button
            key={floor.key}
            size="xs"
            variant={zoom === floor.key ? 'secondary' : 'ghost'}
            aria-pressed={zoom === floor.key}
            className="max-w-32 truncate"
            onClick={() => setZoom(floor.key)}
          >
            {teamHostText(floor.host)}
          </Button>
        ))}
      </nav>
      <div className="min-w-0">
        {shown.map((floor) => (
          <FloorStage key={floor.key} {...props} floor={floor} zoomed={zoomed !== null} />
        ))}
        {more > 0 ? (
          <div className="px-2 py-1 text-xs text-muted-foreground">{`+${more}`}</div>
        ) : null}
      </div>
    </div>
  )
}
