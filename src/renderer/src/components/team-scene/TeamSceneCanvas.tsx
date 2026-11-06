import React, { useCallback, useEffect, useRef, useState } from 'react'
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
import { createTeamSceneFrameLoop } from './team-scene-frame-loop'
import { TeamSceneBubbles, type TeamSceneSpeech } from './TeamSceneBubbles'
import type { TeamScenePainter } from './team-scene-painter'

type Props = {
  input: TeamSceneInput
  painter: TeamScenePainter
  /** Translated by the caller; the canvas is one image to assistive tech. */
  label: string
  /** The lead's live step for its bubble, already worded by the caller; null shows none. */
  leadLine: string | null
}

// Why: the advisor's line fades on a timer; without frames the timer is the wall clock.
const ADVISOR_BUBBLE_MS = 6000

export function TeamSceneCanvas({ input, painter, label, leadLine }: Props): React.JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const worldRef = useRef<TeamSceneWorld | null>(null)
  const reducedMotion = usePrefersReducedMotion()
  const [speakers, setSpeakers] = useState<{
    width: number
    advisor: string | null
    anchors: Map<string, TeamSceneSpeech['anchor']>
  }>({ width: 0, advisor: null, anchors: new Map() })
  const speakersKeyRef = useRef('')

  const paint = useCallback(
    (dt: number) => {
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
      stepTeamScene(world, dt, { width })
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
      // Why keyed: speakers stand still, so the overlay re-renders only when a line or size changes.
      const key = `${width}|${advisor}|${[...anchors.keys()].join()}`
      if (key !== speakersKeyRef.current) {
        speakersKeyRef.current = key
        setSpeakers({ width, advisor, anchors })
      }
      painter.paint(g, {
        width,
        height,
        ratio,
        t: world.t,
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

  const speeches: TeamSceneSpeech[] = []
  const leadAnchor = speakers.anchors.get('lead')
  if (leadLine && leadAnchor) {
    speeches.push({ key: 'lead', text: leadLine, anchor: leadAnchor })
  }
  const advisorAnchor = speakers.anchors.get('advisor')
  if (speakers.advisor && advisorAnchor) {
    speeches.push({ key: 'advisor', text: speakers.advisor, anchor: advisorAnchor })
  }

  return (
    <div className="relative">
      <canvas
        ref={canvasRef}
        role="img"
        aria-label={label}
        className="block w-full"
        style={{ height: painter.height }}
      />
      <TeamSceneBubbles speeches={speeches} width={speakers.width} height={painter.height} />
    </div>
  )
}
