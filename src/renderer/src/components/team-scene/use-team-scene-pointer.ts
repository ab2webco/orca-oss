import type React from 'react'
import { useRef, useState } from 'react'
import type { TeamSceneActor } from '../../../../shared/team-scene/team-scene-types'
import {
  teamSceneActorBox,
  teamSceneMemberAt,
  useTeamSceneHover,
  type TeamSceneWho
} from './team-scene-hit'
import type { TeamScenePainter } from './team-scene-painter'

const LONG_PRESS_MS = 500

/**
 * Pointing at a member in the scene: hover lights it here and in the Team list, a click opens it
 * as its row does, and on touch a long press shows its label without opening it (ORCA-1219).
 */
export function useTeamScenePointer(args: {
  canvasRef: React.RefObject<HTMLCanvasElement | null>
  actorsRef: React.RefObject<TeamSceneActor[]>
  painter: TeamScenePainter
  members: ReadonlyMap<string, TeamSceneWho> | undefined
}) {
  const { canvasRef, actorsRef, painter, members } = args
  const setHover = useTeamSceneHover((s) => s.set)
  const own = useRef<string | null>(null)
  const press = useRef<{ timer: number; held: boolean } | null>(null)
  const [over, setOver] = useState(false)
  if (!members) {
    return null
  }
  const hitAt = (event: { clientX: number; clientY: number }): string | null => {
    const canvas = canvasRef.current
    if (!canvas) {
      return null
    }
    const r = canvas.getBoundingClientRect()
    const key = teamSceneMemberAt(
      actorsRef.current,
      { x: event.clientX - r.left, y: event.clientY - r.top },
      (a) => teamSceneActorBox(a, painter, r.width, painter.height)
    )
    return key && members.has(key) ? key : null
  }
  const point = (key: string | null): void => {
    if (key === own.current) {
      return
    }
    // Why only our own: the Team list may be lighting a member, and leaving the stage keeps that.
    if (key !== null || useTeamSceneHover.getState().key === own.current) {
      setHover(key)
    }
    own.current = key
    setOver(key !== null)
  }
  const release = (): void => window.clearTimeout(press.current?.timer)
  const handlers = {
    onPointerMove: (event: React.PointerEvent) => {
      if (event.pointerType !== 'touch') {
        point(hitAt(event))
      }
    },
    onPointerLeave: () => {
      release()
      point(null)
    },
    onPointerDown: (event: React.PointerEvent) => {
      const key = event.pointerType === 'touch' ? hitAt(event) : null
      if (key) {
        const held = { held: false, timer: 0 }
        held.timer = window.setTimeout(() => {
          held.held = true
          point(key)
        }, LONG_PRESS_MS)
        press.current = held
      }
    },
    onPointerUp: release,
    onPointerCancel: release,
    onClick: (event: React.MouseEvent) => {
      const held = press.current?.held
      press.current = null
      const key = held ? null : hitAt(event)
      if (key) {
        members.get(key)!.open()
      }
    }
  }
  return { over, handlers }
}
