import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { teamSceneActors } from '../../../../shared/team-scene/team-scene-actors'
import {
  advisorLineShown,
  applyTeamSceneInput,
  createTeamSceneWorld,
  drainTeamSceneEffects,
  settleTeamScene,
  stepTeamScene,
  type TeamSceneWorld
} from '../../../../shared/team-scene/team-scene-director'
import {
  drainTeamSceneBoarded,
  teamSceneGuestAttends
} from '../../../../shared/team-scene/team-scene-elevator'
import { teamSceneLeadAttends } from '../../../../shared/team-scene/team-scene-lead-rounds'
import type { TeamSceneInput } from '../../../../shared/team-scene/team-scene-types'
import { usePrefersReducedMotion } from '@/hooks/usePrefersReducedMotion'
import { teamSceneLabel } from './team-scene-copy'
import { createTeamSceneFrameLoop } from './team-scene-frame-loop'
import { TeamSceneBubbles, type TeamSceneSpeech } from './TeamSceneBubbles'
import type { TeamSceneRect } from './team-scene-bubble-layout'
import type { TeamScenePainter } from './team-scene-painter'

type Props = {
  input: TeamSceneInput
  painter: TeamScenePainter
  /** The lead's bubble, from `teamSceneLeadLineOf`; null shows none. */
  leadLine: string | null
  /** Which speeches the last layout left without a bubble. */
  onUnplaced?: (keys: string[]) => void
  /** The lead or advisor stepped into the building's elevator. */
  onBoarded?: (rider: string) => void
  /** Rows of the stage a building floor hides above and below; only the canvas is cut, never a bubble. */
  crop?: { top: number; bottom: number }
  /** Where the stage's bubbles may start: a top floor keeps them under its own cropped top. */
  visibleTop?: number
  /** Told each asker's tag-and-mark box, so a floor below keeps its bubbles off them. */
  onAskers?: (boxes: TeamSceneRect[]) => void
  /** Boxes from outside the stage its bubbles must not cover, as the floor above's askers. */
  extraObstacles?: readonly TeamSceneRect[]
}

// Why: the advisor's line fades on a timer; without frames the timer is the wall clock.
const ADVISOR_BUBBLE_MS = 6000
const NO_RECTS: readonly TeamSceneRect[] = []
const CAPPED_EDGE_FADE =
  'linear-gradient(to right, transparent, black 24px, black calc(100% - 24px), transparent)'

/** `bottom`: where its alert mark ends, below the tag at `top`. */
type TeamSceneAsker = { key: string; name: string; x: number; top: number; bottom: number }

// Why: V28 names the asker in a tag above its alert mark, which sits about 20px over the head.
const ASKER_LIFT = 38
// From a moved mark's centre: its 7px radius, a 2px gap, then the 16px tag.
const MARK_LIFT = 25
const ASKER_EDGE = 32
// Half a tag of its usual width, for a box measured before the tag has laid out; the mark's radius.
const TAG_HALF = 28
const MARK_R = 9
// How far a speaker moves before its bubble follows.
const ANCHOR_STEP_PX = 4

export function TeamSceneCanvas({
  input,
  painter,
  leadLine,
  onUnplaced,
  onBoarded,
  crop,
  visibleTop,
  onAskers,
  extraObstacles = NO_RECTS
}: Props): React.JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const worldRef = useRef<TeamSceneWorld | null>(null)
  const reducedMotion = usePrefersReducedMotion()
  const [speakers, setSpeakers] = useState<{
    width: number
    advisor: string | null
    anchors: Map<string, TeamSceneSpeech['anchor']>
    askers: TeamSceneAsker[]
    /** The lead stands by a member who asks, under that member's tag. */
    leadAttends: boolean
  }>({ width: 0, advisor: null, anchors: new Map(), askers: [], leadAttends: false })
  const speakersKeyRef = useRef('')
  const tagRefs = useRef(new Map<string, HTMLSpanElement>())
  const [tags, setTags] = useState<TeamSceneRect[]>([])
  const askersKeyRef = useRef('')
  const onAskersRef = useRef(onAskers)
  const onBoardedRef = useRef(onBoarded)
  // Why in a layout effect: render stays pure, and the latest callbacks are in place before paint.
  useLayoutEffect(() => {
    onAskersRef.current = onAskers
    onBoardedRef.current = onBoarded
  })
  const obstacles = useMemo(() => [...tags, ...extraObstacles], [tags, extraObstacles])

  const paint = useCallback(
    (dt: number, elapsed = dt) => {
      const canvas = canvasRef.current
      const world = worldRef.current
      const width = canvas?.clientWidth ?? 0
      if (!canvas || !world || width === 0) {
        return
      }
      const ratio = window.devicePixelRatio || 1
      const { height } = painter
      if (canvas.width !== Math.round(width * ratio)) {
        canvas.width = Math.round(width * ratio)
        canvas.height = Math.round(height * ratio)
      }
      stepTeamScene(world, dt, { width, elapsed })
      // Why a fade only when capped: the stage then shows its art whole, and the art's own edge
      // would cut a prop in half; under the cap the art is a central crop and needs none.
      const room = canvas.parentElement?.parentElement?.clientWidth ?? width
      const capped = painter.maxWidth !== undefined && room > painter.maxWidth
      canvas.style.setProperty('mask-image', capped ? CAPPED_EDGE_FADE : '')
      drainTeamSceneBoarded(world).forEach((rider) => onBoardedRef.current?.(rider))
      const g = canvas.getContext('2d')
      if (!g) {
        return
      }
      g.setTransform(ratio, 0, 0, ratio, 0, 0)
      const actors = teamSceneActors(world)
      const advisor = advisorLineShown(world)
      const anchors = new Map(
        actors
          .filter((a) => a.role !== 'member')
          .map((a) => [a.key, { x: a.x * width, top: painter.headTop(a.depth, height) }])
      )
      const askers = actors
        .filter((a) => a.role === 'member' && a.emote === 'alert')
        .map((a) => {
          const mark = painter.emoteAt?.(a, { width, height, stations: world.stations })
          return {
            key: a.key,
            name: a.name,
            x: Math.round(mark ? mark.x : a.x * width),
            top: Math.round(
              mark ? mark.y - MARK_LIFT : painter.headTop(a.depth, height) - ASKER_LIFT
            ),
            bottom: Math.round(mark ? mark.y + MARK_R : painter.headTop(a.depth, height))
          }
        })
      const leadAttends = teamSceneLeadAttends(world) || teamSceneGuestAttends(world)
      // Why keyed, and by a few px: the overlay re-renders only when a line, size or speaker moves,
      // so a walking lead's bubble follows it without a render every frame.
      const key = `${width}|${advisor}|${leadAttends}|${[...anchors]
        .map(([k, a]) => `${k}:${Math.round(a.x / ANCHOR_STEP_PX)}`)
        .join()}|${askers.map((a) => `${a.key}:${a.name}:${a.x}:${a.top}`).join()}`
      if (key !== speakersKeyRef.current) {
        speakersKeyRef.current = key
        setSpeakers({ width, advisor, anchors, askers, leadAttends })
      }
      painter.paint(g, {
        width,
        height,
        ratio,
        // Why the clock: idle sway keeps real pace on a slow renderer; only walks need the capped step.
        t: world.clock,
        dt,
        actors,
        effects: drainTeamSceneEffects(world),
        overflow: world.overflow,
        stations: world.stations,
        sites: world.sites,
        trophies: world.trophies,
        stopped: world.stopped
      })
    },
    [painter]
  )

  useEffect(() => {
    worldRef.current ??= createTeamSceneWorld()
    applyTeamSceneInput(worldRef.current, input, painter.layout)
    if (!reducedMotion) {
      return
    }
    const world = worldRef.current
    settleTeamScene(world)
    paint(0)
    if (advisorLineShown(world) === null) {
      return
    }
    const timer = window.setTimeout(() => {
      stepTeamScene(world, ADVISOR_BUBBLE_MS / 1000, { width: canvasRef.current?.clientWidth ?? 0 })
      settleTeamScene(world)
      paint(0)
    }, ADVISOR_BUBBLE_MS)
    return () => window.clearTimeout(timer)
  }, [input, reducedMotion, paint, painter.layout])

  useEffect(() => {
    const canvas = canvasRef.current
    if (reducedMotion || !canvas) {
      return
    }
    const loop = createTeamSceneFrameLoop(paint, {
      request: (cb) => window.requestAnimationFrame(cb),
      cancel: (id) => window.cancelAnimationFrame(id)
    })
    let onScreen = true
    const sync = (): void => loop.setRunning(onScreen && document.visibilityState !== 'hidden')
    // Why both: a hidden window and a panel scrolled or collapsed out of view each stop the frames.
    const observer =
      typeof IntersectionObserver === 'function'
        ? new IntersectionObserver(([entry]) => {
            onScreen = entry?.isIntersecting ?? true
            sync()
          })
        : null
    observer?.observe(canvas)
    document.addEventListener('visibilitychange', sync)
    sync()
    return () => {
      document.removeEventListener('visibilitychange', sync)
      observer?.disconnect()
      loop.dispose()
    }
  }, [reducedMotion, paint])

  useEffect(() => {
    const canvas = canvasRef.current
    return () => {
      painter.dispose()
      // Why: a zero-size canvas lets the browser free its backing store right away.
      if (canvas) {
        canvas.width = 0
        canvas.height = 0
      }
    }
  }, [painter])

  // Why measured: a tag is as wide as its name, and no bubble may cover it (ORCA-1139).
  useLayoutEffect(() => {
    const stage = canvasRef.current?.getBoundingClientRect()
    const next = speakers.askers.flatMap((asker) => {
      const box = tagRefs.current.get(asker.key)?.getBoundingClientRect()
      return stage && box && box.width > 0
        ? [
            {
              left: box.left - stage.left,
              top: box.top - stage.top,
              width: box.width,
              height: box.height
            }
          ]
        : []
    })
    setTags((old) => (JSON.stringify(old) === JSON.stringify(next) ? old : next))
    const boxes = speakers.askers.map((asker) => {
      const tag = next.find((one) => one.left <= asker.x && asker.x <= one.left + one.width)
      const left = tag ? tag.left : asker.x - TAG_HALF
      const width = tag ? tag.width : 2 * TAG_HALF
      return { left, top: asker.top, width, height: Math.max(0, asker.bottom - asker.top) }
    })
    const key = JSON.stringify(boxes)
    if (key !== askersKeyRef.current) {
      askersKeyRef.current = key
      onAskersRef.current?.(boxes)
    }
  }, [speakers])

  const speeches: TeamSceneSpeech[] = []
  // Why the advisor first: it keeps its spot, and the lead's bubble climbs above it on a clash.
  const advisorAnchor = speakers.anchors.get('advisor')
  if (speakers.advisor && advisorAnchor) {
    speeches.push({
      key: 'advisor',
      text: speakers.advisor,
      anchor: advisorAnchor,
      align: 'end',
      yields: true
    })
  }
  const leadAnchor = speakers.anchors.get('lead')
  if (leadLine && leadAnchor) {
    speeches.push({
      key: 'lead',
      text: leadLine,
      anchor: leadAnchor,
      attending: speakers.leadAttends
    })
  }

  return (
    <div
      className="relative mx-auto"
      style={painter.maxWidth ? { maxWidth: painter.maxWidth } : undefined}
      // Why exposed: specs crop the lead's pixels, and on its rounds it leaves its spot.
      data-scene-lead-x={
        leadAnchor && speakers.width > 0 ? (leadAnchor.x / speakers.width).toFixed(2) : undefined
      }
    >
      <canvas
        ref={canvasRef}
        role="img"
        aria-label={teamSceneLabel()}
        className="block w-full"
        style={{
          height: painter.height,
          ...(crop ? { clipPath: `inset(${crop.top}px 0px ${crop.bottom}px)` } : {})
        }}
      />
      {speakers.askers.map((asker) => (
        <span
          key={asker.key}
          ref={(el) => {
            if (el) {
              tagRefs.current.set(asker.key, el)
            } else {
              tagRefs.current.delete(asker.key)
            }
          }}
          data-scene-speaker={asker.key}
          aria-hidden="true"
          className="pointer-events-none absolute max-w-[96px] -translate-x-1/2 truncate rounded bg-status-attention px-1.5 py-px text-[10.5px] font-medium leading-4 text-white"
          style={{
            left: Math.min(Math.max(asker.x, ASKER_EDGE), speakers.width - ASKER_EDGE),
            top: asker.top
          }}
        >
          {asker.name}
        </span>
      ))}
      <TeamSceneBubbles
        speeches={speeches}
        width={speakers.width}
        height={painter.height}
        cloudPixel={painter.cloudPixel}
        obstacles={obstacles}
        onUnplaced={onUnplaced}
        visibleTop={visibleTop}
      />
    </div>
  )
}
