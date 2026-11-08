import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
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
}

// Why: the advisor's line fades on a timer; without frames the timer is the wall clock.
const ADVISOR_BUBBLE_MS = 6000

type TeamSceneAsker = { key: string; name: string; x: number; top: number }

// Why: V28 names the asker in a tag above its alert mark, which sits about 20px over the head.
const ASKER_LIFT = 38
const ASKER_EDGE = 32

export function TeamSceneCanvas({ input, painter, leadLine }: Props): React.JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const worldRef = useRef<TeamSceneWorld | null>(null)
  const reducedMotion = usePrefersReducedMotion()
  const [speakers, setSpeakers] = useState<{
    width: number
    advisor: string | null
    anchors: Map<string, TeamSceneSpeech['anchor']>
    askers: TeamSceneAsker[]
  }>({ width: 0, advisor: null, anchors: new Map(), askers: [] })
  const speakersKeyRef = useRef('')
  const tagRefs = useRef(new Map<string, HTMLSpanElement>())
  const [tags, setTags] = useState<TeamSceneRect[]>([])

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
        .map((a) => ({
          key: a.key,
          name: a.name,
          x: Math.round(a.x * width),
          top: Math.round(painter.headTop(a.depth, height) - ASKER_LIFT)
        }))
      // Why keyed: speakers stand still, so the overlay re-renders only when a line or size changes.
      const key = `${width}|${advisor}|${[...anchors.keys()].join()}|${askers
        .map((a) => `${a.key}:${a.name}:${a.x}:${a.top}`)
        .join()}`
      if (key !== speakersKeyRef.current) {
        speakersKeyRef.current = key
        setSpeakers({ width, advisor, anchors, askers })
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
        stations: world.stations
      })
    },
    [painter]
  )

  useEffect(() => {
    worldRef.current ??= createTeamSceneWorld()
    applyTeamSceneInput(worldRef.current, input)
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
  }, [input, reducedMotion, paint])

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
    speeches.push({ key: 'lead', text: leadLine, anchor: leadAnchor })
  }

  return (
    <div className="relative">
      <canvas
        ref={canvasRef}
        role="img"
        aria-label={teamSceneLabel()}
        className="block w-full"
        style={{ height: painter.height }}
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
        obstacles={tags}
      />
    </div>
  )
}
