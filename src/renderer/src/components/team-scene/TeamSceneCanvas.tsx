import React, { useCallback, useEffect, useRef } from 'react'
import { teamSceneActors } from '../../../../shared/team-scene/team-scene-actors'
import {
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
import type { TeamScenePainter } from './team-scene-painter'

type Props = {
  input: TeamSceneInput
  painter: TeamScenePainter
  /** Translated by the caller; the canvas is one image to assistive tech. */
  label: string
}

export function TeamSceneCanvas({ input, painter, label }: Props): React.JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const worldRef = useRef<TeamSceneWorld | null>(null)
  const reducedMotion = usePrefersReducedMotion()

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
      painter.paint(g, {
        width,
        height,
        ratio,
        t: world.t,
        dt,
        actors: teamSceneActors(world),
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
    if (reducedMotion) {
      settleTeamScene(worldRef.current)
      paint(0)
    }
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

  return (
    <canvas
      ref={canvasRef}
      role="img"
      aria-label={label}
      className="block w-full"
      style={{ height: painter.height }}
    />
  )
}
