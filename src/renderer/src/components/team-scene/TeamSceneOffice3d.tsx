import React, { useEffect, useMemo, useRef, useState } from 'react'
import type * as THREE from 'three'
import type { TeamPanelGameModel } from '../../../../shared/team-panel-model-types'
import { teamOffice3dLayoutOf } from '../../../../shared/team-scene/team-office3d-layout'
import {
  office3dTraffic,
  office3dTrafficRead
} from '../../../../shared/team-scene/team-office3d-traffic'
import { teamSceneFloorsOf } from '../../../../shared/team-scene/team-scene-floors'
import { teamSceneInputOf } from '../../../../shared/team-scene/team-scene-input'
import { dioramaRenderer } from './team-diorama-stage'
import { office3dStage } from './team-office3d-stage'
import type { TeamSceneWho } from './team-scene-hit'
import { linkScene3dHover, type Scene3dHoverHold } from './team-scene3d-hover'
import { DioramaCameraButtons } from './DioramaCameraButtons'
import { useDioramaCameraInput } from './use-diorama-camera-input'
import { teamSceneLabel } from './team-scene-copy'
import { useTeamSceneStatusColors } from './team-scene-status-colors'
import { useTeamSceneDioramaLook } from './use-team-scene-style'
import { localHostDisplayLabel } from '@/lib/local-host-display-label'
import { translate } from '@/i18n/i18n'
import { TeamBuildingResizeHandle } from './TeamBuildingResizeHandle'
import { OFFICE3D_HEIGHT_KEY, office3dDefaultHeight } from './team-office3d-height'
import { teamBuildingHeightOf, useTeamBuildingHeight } from './use-team-building-height'

const FRAME_MS = 1000 / 30
// The arrow keys' step: one 2D floor strip.
const OFFICE3D_STEP = 112

/** The Office as the 3D building (ORCA-1302); Low resources keeps the 2D Office, so no lite mode. */
export function TeamSceneOffice3d({
  model,
  onNoWebgl,
  members
}: {
  model: TeamPanelGameModel
  /** Without WebGL the panel draws today's 2D Office instead. */
  onNoWebgl: () => void
  /** What a click on a member's figure opens, as its Team row does. */
  members?: ReadonlyMap<string, TeamSceneWho>
}): React.JSX.Element {
  const wrap = useRef<HTMLDivElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const order = useRef<Record<string, (string | null)[]> | undefined>(undefined)
  const gl = useRef<THREE.WebGLRenderer | null>(null)
  // Why the diorama's own camera: the owner asked the Office to pan, zoom and follow like Figures.
  const redraw = useRef<(() => void) | null>(null)
  // Why a ref: a rebuild relinks the canvas, and the hover it lit must survive that.
  const hover = useRef<Scene3dHoverHold>({ own: null, down: null })
  // Why a ref: a new map each read must not rebuild the stage.
  const who = useRef(members)
  useEffect(() => {
    who.current = members
  }, [members])
  const camera = useDioramaCameraInput(canvas, redraw)
  const status = useTeamSceneStatusColors()
  const look = useTeamSceneDioramaLook()
  const [width, setWidth] = useState(0)
  const input = useMemo(() => teamSceneInputOf(model), [model])
  // Why the last order: a new member takes a free desk and moves nobody already seated.
  const layout = useMemo(
    () =>
      teamOffice3dLayoutOf(teamSceneFloorsOf(model), {
        leadAdvisor: model.advisor != null,
        previous: order.current
      }),
    [model]
  )
  useEffect(() => {
    order.current = layout.order
  }, [layout])
  const machines = layout.floors.filter((f) => !f.lobby).length
  const [wanted, setWanted] = useTeamBuildingHeight(OFFICE3D_HEIGHT_KEY)
  // Why the stage's full height as the top: past it the building only grows empty margins.
  const [full, setFull] = useState(0)
  const bounds = { min: office3dDefaultHeight(machines), max: 0 }
  bounds.max = Math.max(bounds.min, full)
  const height = teamBuildingHeightOf(wanted, bounds)
  // Why a ref: each read rebuilds the stage, and a trip under way must carry on, not restart.
  const traffic = useRef(office3dTraffic())

  useEffect(() => {
    const el = wrap.current
    if (!el) {
      return
    }
    const observer = new ResizeObserver(() => setWidth(Math.round(el.clientWidth)))
    observer.observe(el)
    setWidth(Math.round(el.clientWidth))
    return () => {
      observer.disconnect()
      gl.current?.dispose()
      gl.current = null
    }
  }, [])

  useEffect(() => {
    const el = canvas.current
    if (!el) {
      return
    }
    // Why one renderer per canvas: a new WebGL context per read runs into the browser's cap.
    const renderer = (gl.current ??= dioramaRenderer(el, true))
    if (!renderer) {
      onNoWebgl()
      return
    }
    if (width === 0) {
      return
    }
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    office3dTrafficRead(traffic.current, layout, input, performance.now() / 1000, look.pace)
    const stage = office3dStage(renderer, {
      width,
      height,
      dark: document.documentElement.classList.contains('dark'),
      status,
      input,
      layout,
      pace: look.pace,
      view: camera.view.current,
      traffic: traffic.current,
      words: {
        thisMachine: localHostDisplayLabel(),
        offline: translate('teamPanel.machines.offline', 'Offline'),
        lobby: translate('auto.components.team-scene.TeamSceneOffice3d.lobby', 'Lobby')
      }
    })
    setFull(stage.full)
    let raf = 0,
      last = 0,
      visible = true
    const loop = (now: number) => {
      raf = requestAnimationFrame(loop)
      if (!visible || document.hidden || now - last < FRAME_MS) {
        return
      }
      last = now
      stage.draw(now / 1000)
    }
    const watch = new IntersectionObserver(([entry]) => {
      visible = entry?.isIntersecting ?? true
    })
    watch.observe(el)
    stage.draw(reduced ? 1.3 : performance.now() / 1000)
    // Under reduced motion nothing animates, so a camera move paints its own still frame.
    redraw.current = reduced
      ? () => {
          camera.view.current.target = null
          stage.draw(1.3)
        }
      : null
    if (!reduced) {
      raf = requestAnimationFrame(loop)
    }
    const unlink = linkScene3dHover({
      el,
      pick: stage.pick,
      light: (key) => {
        stage.light(key)
        // Under reduced motion no frame runs, so the ring paints its own still frame.
        if (reduced) {
          stage.draw(1.3)
        }
        el.dataset.office3dLit = key ?? ''
      },
      open: (key) => who.current?.get(key)?.open(),
      hold: hover.current
    })
    // The machines' floors: the shared lobby is not one.
    el.dataset.office3dFloors = String(layout.floors.filter((f) => !f.lobby).length)
    el.dataset.office3dAdvisors = String(layout.floors.filter((f) => f.controlRoom).length)
    // Where each member belongs now, for specs: 'key:place' pairs.
    el.dataset.office3dPlaces = [...traffic.current.members.values()]
      .map((m) => `${m.key}:${m.leaving ? 'gone' : m.place}`)
      .join(' ')
    return () => {
      cancelAnimationFrame(raf)
      unlink()
      watch.disconnect()
      stage.dispose()
    }
  }, [layout, input, status, width, height, onNoWebgl, look, camera.view])

  return (
    <div ref={wrap} className="relative w-full" data-team-scene-office3d="">
      <canvas
        ref={canvas}
        role="img"
        aria-label={teamSceneLabel()}
        className="block w-full"
        data-office3d-camera={camera.mode}
      />
      <DioramaCameraButtons mode={camera.mode} setMode={camera.setMode} />
      <TeamBuildingResizeHandle
        height={height}
        min={bounds.min}
        max={bounds.max}
        step={OFFICE3D_STEP}
        onResize={setWanted}
      />
    </div>
  )
}
