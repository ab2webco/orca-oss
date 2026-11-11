import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { TeamPanelGameModel } from '../../../../shared/team-panel-model-types'
import {
  teamSceneFloorInputOf,
  teamSceneFloorsOf,
  teamSceneJudgedFloorOf,
  teamSceneRideOf,
  type TeamSceneFloor,
  type TeamSceneFloorLegs
} from '../../../../shared/team-scene/team-scene-floors'
import { teamSceneLegCar } from '../../../../shared/team-scene/team-scene-ride-legs'
import { usePrefersReducedMotion } from '@/hooks/usePrefersReducedMotion'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { translate } from '@/i18n/i18n'
import { teamHostText } from '../team-panel/team-card-text'
import { TeamSceneCanvas } from './TeamSceneCanvas'
import { teamSceneRectsFromAbove, type TeamSceneRect } from './team-scene-bubble-layout'
import { TeamSceneElevatorShaft } from './TeamSceneElevatorShaft'
import { TEAM_SCENE_ART_HEIGHT } from './team-scene-image-painter'
import { teamSceneLabel } from './team-scene-copy'
import { useTeamBuildingScroll } from './use-team-building-scroll'
import { useTeamSceneRideLegs } from './use-team-scene-ride-legs'
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
// Each storey up crops less, so higher floors look out over more sky than the lead's street level.
const STRIP = { height: 112, slab: 4, crop: 66, perLevel: 10, minCrop: 36 }
const cropOf = (level: number): number =>
  Math.max(STRIP.minCrop, STRIP.crop - level * STRIP.perLevel)
const NO_BOXES: readonly TeamSceneRect[] = []
// The plate's inset from the floor's corner: left-1.5 top-1.5.
const PLATE_INSET = 6
const TUBE_SECONDS = 1.6
// Why this long: the ride in, the walk to the judged desk and the gesture held there.
const ADVISOR_RIDE_SECONDS = 12

/** The floor the advisor rode to for a Jev decision on a member there, until it is done; else null. */
function useAdvisorRide(floors: readonly TeamSceneFloor[]): string | null {
  const seen = useRef(new Set<string>())
  const [floor, setFloor] = useState<string | null>(null)
  useEffect(() => {
    const judged = teamSceneJudgedFloorOf(floors, seen.current)
    if (judged !== null) {
      setFloor(judged)
    }
  }, [floors])
  useEffect(() => {
    if (floor === null) {
      return
    }
    const timer = setTimeout(() => setFloor(null), ADVISOR_RIDE_SECONDS * 1000)
    return () => clearTimeout(timer)
  }, [floor])
  return floor
}

/** A report a member on another floor just filed, travelling up the tube; never under reduced motion. */
function useTubeEnvelope(
  floors: readonly TeamSceneFloor[],
  reducedMotion: boolean
): { from: string; id: number } | null {
  const seen = useRef(new Map<string, string | null>())
  const [envelope, setEnvelope] = useState<{ from: string; id: number } | null>(null)
  useEffect(() => {
    let filed: string | null = null
    for (const floor of floors) {
      for (const member of floor.members) {
        const before = seen.current.get(member.paneKey)
        if (!floor.lead && member.summary && before !== undefined && before !== member.summary) {
          filed = floor.key
        }
        seen.current.set(member.paneKey, member.summary)
      }
    }
    if (filed && !reducedMotion) {
      setEnvelope({ from: filed, id: Date.now() })
    }
  }, [floors, reducedMotion])
  useEffect(() => {
    if (!envelope) {
      return
    }
    const timer = setTimeout(() => setEnvelope(null), TUBE_SECONDS * 1000)
    return () => clearTimeout(timer)
  }, [envelope])
  return reducedMotion ? null : envelope
}
// Why three: the building kept this height before it drew every floor, and scrolls past it.
const VIEW_FLOORS = 3

/** True when the team spans more than one machine: the building replaces the single office. */
export const teamSceneHasFloors = (model: TeamSceneBuildingModel): boolean =>
  teamSceneFloorsOf(model).length > 1

function FloorStage({
  model,
  floor,
  makePainter,
  leadLine,
  onUnplaced,
  zoomed,
  level,
  legs,
  onBoarded,
  aboveView,
  onAskers,
  fromAbove,
  floorRef
}: Props & {
  floor: TeamSceneFloor
  zoomed: boolean
  level: number
  legs: TeamSceneFloorLegs
  onBoarded: (rider: string) => void
  /** How far above the scroller's visible top this floor starts, in px; negative when below it. */
  aboveView: number
  onAskers: (floor: string, boxes: TeamSceneRect[]) => void
  /** The floor above's asker boxes, in this floor's stage: its rising bubbles keep off them. */
  fromAbove: readonly TeamSceneRect[]
  floorRef: (el: HTMLElement | null) => void
}): React.JSX.Element | null {
  const painter = useMemo(makePainter, [makePainter])
  const input = useMemo(() => teamSceneFloorInputOf(model, floor, legs), [model, floor, legs])
  const cropTop = zoomed ? 0 : cropOf(level)
  const plateRef = useRef<HTMLSpanElement>(null)
  const [plate, setPlate] = useState<TeamSceneRect | null>(null)
  // Why measured: the plate is as wide as its host's name, and no bubble may cover it.
  useLayoutEffect(() => {
    const el = plateRef.current
    const next =
      el && el.offsetWidth > 0
        ? {
            left: PLATE_INSET,
            top: cropTop + PLATE_INSET,
            width: el.offsetWidth,
            height: el.offsetHeight
          }
        : null
    setPlate((old) => (JSON.stringify(old) === JSON.stringify(next) ? old : next))
  }, [cropTop, floor.host])
  const obstacles = useMemo(() => (plate ? [plate, ...fromAbove] : fromAbove), [plate, fromAbove])
  if (!painter) {
    return null
  }
  // Why where it stands: the lead's line goes with it on a visit, and none rides in the car.
  const leg = legs.lead
  const leadHere =
    leg.stage === 'home' || leg.stage === 'out'
      ? floor.lead
      : (leg.stage === 'there' || leg.stage === 'back') && floor.key === leg.away
  const crop = zoomed
    ? undefined
    : { top: cropTop, bottom: Math.max(0, painter.height - cropTop - STRIP.height) }
  return (
    <div
      ref={floorRef}
      data-team-floor={floor.key}
      data-team-floor-dark={floor.reachable ? undefined : ''}
      // Why a slab and an inner ring: floors read as storeys of one glass building, not copies.
      // Why no overflow clip: only the canvas is cropped, so a bubble rises over the slab above.
      // Why flow-root: its own block context, or the view's negative margin lifts the whole floor.
      // Why a dark floor: a stage capped at its art's width leaves the floor's sides showing.
      className="relative flow-root border-b-4 border-border bg-scene-bubble ring-1 ring-inset ring-white/10 last:border-b-0"
      style={zoomed ? undefined : { height: STRIP.height }}
    >
      <div
        data-team-floor-view=""
        // Why no pointer: the uncropped view reaches over the floor above and the nav, whose
        // buttons must keep their clicks; the scene itself is an image.
        className="pointer-events-none"
        style={zoomed ? undefined : { marginTop: -cropTop }}
      >
        <TeamSceneCanvas
          input={input}
          painter={painter}
          leadLine={leadHere ? leadLine : null}
          onUnplaced={leadHere ? onUnplaced : undefined}
          onBoarded={onBoarded}
          crop={crop}
          // Why from the scroller: what is above a floor scrolled to the top is not drawn, so no
          // bubble may rise into it; lower floors may rise over the slab into the one above.
          visibleTop={zoomed ? 0 : Math.max(0, cropTop + aboveView)}
          onAskers={(boxes) => onAskers(floor.key, boxes)}
          extraObstacles={obstacles}
        />
      </div>
      {/* Why a deeper night each storey up: the same skyline seen from higher reads as another floor. */}
      {level > 0 && !zoomed ? (
        <div
          className={cn(
            'pointer-events-none absolute inset-x-0 top-0 h-1/2 bg-gradient-to-b to-transparent',
            level === 1 ? 'from-black/25' : 'from-black/45'
          )}
        />
      ) : null}
      {/* Why no words: the dark floor and its members' static screens say it cannot be reached. */}
      {floor.reachable ? null : (
        <div className="pointer-events-none absolute inset-0 bg-scene-bubble/80" />
      )}
      {/* Why last: the name stays readable over a dark, unreachable floor. */}
      <span
        ref={plateRef}
        data-team-floor-plate=""
        className="pointer-events-none absolute left-1.5 top-1.5 rounded-sm bg-scene-bubble/85 px-1.5 py-0.5 font-mono text-[10.5px] text-white"
      >
        {teamHostText(floor.host)}
      </span>
    </div>
  )
}

/** One floor per machine the team runs on; a button or a number key zooms into one. */
export function TeamSceneBuilding(props: Props): React.JSX.Element {
  const floors = useMemo(() => teamSceneFloorsOf(props.model), [props.model])
  const [zoom, setZoom] = useState<string | null>(null)
  const zoomed = floors.find((floor) => floor.key === zoom) ?? null
  // Why the lead's at the bottom: floor 1 is where the lead stands, the others above it.
  // Why every floor: an owner with five machines saw three and a fold; the building scrolls instead.
  const shown = zoomed ? [zoomed] : floors.toReversed()
  const [askers, setAskers] = useState<Record<string, TeamSceneRect[]>>({})
  const [scrollTop, setScrollTop] = useState(0)
  const onAskers = useCallback(
    (key: string, boxes: TeamSceneRect[]) =>
      setAskers((old) =>
        JSON.stringify(old[key] ?? []) === JSON.stringify(boxes) ? old : { ...old, [key]: boxes }
      ),
    []
  )
  // Why only the floor right above: a bubble rises at most its own crop over the slab.
  const fromAboveOf = (index: number): readonly TeamSceneRect[] => {
    const above = index > 0 && !zoomed ? shown[index - 1] : undefined
    const boxes = above ? askers[above.key] : undefined
    return boxes && boxes.length > 0
      ? teamSceneRectsFromAbove(boxes, {
          stripPlusSlab: STRIP.height + STRIP.slab,
          cropHere: cropOf(floors.indexOf(shown[index]!)),
          cropAbove: cropOf(floors.indexOf(above!))
        })
      : NO_BOXES
  }
  const leadFloor = floors.find((floor) => floor.lead)?.key ?? ''
  const reducedMotion = usePrefersReducedMotion()
  const envelope = useTubeEnvelope(floors, reducedMotion)
  const advisorFloor = useAdvisorRide(floors)
  const { legs, onBoarded } = useTeamSceneRideLegs(
    {
      lead: teamSceneRideOf(floors),
      advisor: advisorFloor === null ? null : { floor: advisorFloor, member: null }
    },
    leadFloor,
    reducedMotion
  )
  // Why the lead's trip first: one car, and the lead's visit is the one someone waits on.
  const leadCar = teamSceneLegCar(legs.lead, leadFloor)
  const advisorCar = teamSceneLegCar(legs.advisor, leadFloor)
  const car = legs.lead.stage === 'home' ? advisorCar : leadCar
  const floorRef = useTeamBuildingScroll({
    openOn: teamSceneRideOf(floors)?.floor ?? leadFloor,
    carAt: car.at,
    reducedMotion
  })
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
      // Why exposed: where each rider is on its trip, for specs and for a reader of the DOM.
      data-team-ride={`${legs.lead.stage}|${legs.advisor.stage}`}
      role="group"
      aria-label={teamSceneLabel()}
      tabIndex={0}
      onKeyDown={onKeyDown}
      className="flex flex-col border-x-4 border-border outline-none focus-visible:ring-2 focus-visible:ring-ring"
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
      <div
        data-team-floors-scroll=""
        onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
        className="scrollbar-sleek flex min-w-0 overflow-y-auto"
        style={zoomed ? undefined : { maxHeight: VIEW_FLOORS * (STRIP.height + STRIP.slab) }}
      >
        <div className="min-w-0 flex-1">
          {shown.map((floor, index) => (
            <FloorStage
              key={floor.key}
              {...props}
              floor={floor}
              zoomed={zoomed !== null}
              level={floors.indexOf(floor)}
              legs={legs}
              onBoarded={onBoarded}
              aboveView={scrollTop - index * (STRIP.height + STRIP.slab)}
              onAskers={onAskers}
              fromAbove={fromAboveOf(index)}
              floorRef={floorRef(floor.key)}
            />
          ))}
        </div>
        <TeamSceneElevatorShaft
          rows={shown.map((floor) => floor.key)}
          rowHeight={zoomed ? TEAM_SCENE_ART_HEIGHT : STRIP.height + STRIP.slab}
          carAt={car.at}
          rider={leadCar.rider ? 'lead' : advisorCar.rider ? 'advisor' : null}
          envelope={envelope}
          leadFloor={leadFloor}
        />
      </div>
    </div>
  )
}
