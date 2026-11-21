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
import { DioramaCameraButtons } from './DioramaCameraButtons'
import { useDioramaCameraInput } from './use-diorama-camera-input'
import { teamSceneLabel } from './team-scene-copy'
import { useTeamSceneStatusColors } from './team-scene-status-colors'
import { useTeamSceneDioramaLook } from './use-team-scene-style'
import { localHostDisplayLabel } from '@/lib/local-host-display-label'
import { translate } from '@/i18n/i18n'

const FRAME_MS = 1000 / 30

/** The Office as the 3D building (ORCA-1302); Low resources keeps the 2D Office, so no lite mode. */
export function TeamSceneOffice3d({
  model,
  onNoWebgl
}: {
  model: TeamPanelGameModel
  /** Without WebGL the panel draws today's 2D Office instead. */
  onNoWebgl: () => void
}): React.JSX.Element {
  const wrap = useRef<HTMLDivElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const order = useRef<Record<string, (string | null)[]> | undefined>(undefined)
  const gl = useRef<THREE.WebGLRenderer | null>(null)
  // Why the diorama's own camera: the owner asked the Office to pan, zoom and follow like Figures.
  const redraw = useRef<(() => void) | null>(null)
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
    // The machines' floors: the shared lobby is not one.
    el.dataset.office3dFloors = String(layout.floors.filter((f) => !f.lobby).length)
    el.dataset.office3dAdvisors = String(layout.floors.filter((f) => f.controlRoom).length)
    return () => {
      cancelAnimationFrame(raf)
      watch.disconnect()
      stage.dispose()
    }
  }, [layout, input, status, width, onNoWebgl, look, camera.view])

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
    </div>
  )
}
