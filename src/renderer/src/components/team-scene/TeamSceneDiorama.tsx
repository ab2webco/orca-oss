import React, { useEffect, useMemo, useRef, useState } from 'react'
import type * as THREE from 'three'
import type { TeamPanelGameModel } from '../../../../shared/team-panel-model-types'
import {
  teamDioramaLayoutOf,
  teamDioramaMachinesOf,
  type DioramaOrder
} from '../../../../shared/team-scene/team-diorama-layout'
import { teamSceneFloorsOf } from '../../../../shared/team-scene/team-scene-floors'
import { teamSceneInputOf } from '../../../../shared/team-scene/team-scene-input'
import {
  dioramaCuesAfter,
  dioramaMoments,
  dioramaViewsOf,
  type DioramaMoments
} from './team-diorama-read'
import { dioramaRenderer, dioramaStage } from './team-diorama-stage'
import { teamSceneLabel } from './team-scene-copy'
import type { TeamSceneWho } from './team-scene-hit'
import { linkScene3dHover, type Scene3dHoverHold } from './team-scene3d-hover'
import { useTeamSceneStatusColors } from './team-scene-status-colors'
import { useTeamSceneDioramaLook } from './use-team-scene-style'
import { useDioramaCameraInput } from './use-diorama-camera-input'
import { DioramaCameraButtons } from './DioramaCameraButtons'
import { TeamBuildingResizeHandle } from './TeamBuildingResizeHandle'
import { teamBuildingHeightOf, useTeamBuildingHeight } from './use-team-building-height'
import { localHostDisplayLabel } from '@/lib/local-host-display-label'
import { translate } from '@/i18n/i18n'

const FRAME_MS = 1000 / 30
const FIGURES_HEIGHT_KEY = 'orca.teamFigures.height'
// The tallest it grows, from the height that fits the islands; past it a member fills the panel.
const FIGURES_GROWTH = 2
const FIGURES_STEP = 56

/** Figures as the 3D diorama (ORCA-1296): one island per machine, each member at its own plot. */
export function TeamSceneDiorama({
  model,
  onNoWebgl,
  members
}: {
  model: TeamPanelGameModel
  /** Without WebGL (hardware acceleration off) the panel draws the 2D Figures instead. */
  onNoWebgl: () => void
  /** What a click on a member's figure opens, as its Team row does. */
  members?: ReadonlyMap<string, TeamSceneWho>
}): React.JSX.Element {
  const wrap = useRef<HTMLDivElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const order = useRef<DioramaOrder | undefined>(undefined)
  const moments = useRef<DioramaMoments>(dioramaMoments())
  const gl = useRef<THREE.WebGLRenderer | null>(null)
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
  // Why the last order: a new machine or member takes a free slot and moves nobody already drawn.
  const layout = useMemo(
    () =>
      teamDioramaLayoutOf(
        teamDioramaMachinesOf(teamSceneFloorsOf(model)),
        order.current,
        width > 0 && width < 300
      ),
    [model, width]
  )
  useEffect(() => {
    order.current = layout.order
  }, [layout])
  const views = useMemo(() => dioramaViewsOf(input), [input])
  // Why its own key: the owner enlarges Figures as the Office, and each keeps its own height.
  const [wanted, setWanted] = useTeamBuildingHeight(FIGURES_HEIGHT_KEY)
  const [fitted, setFitted] = useState(0)
  const bounds = { min: fitted, max: fitted * FIGURES_GROWTH }
  const height = fitted > 0 ? teamBuildingHeightOf(wanted, bounds) : 0

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
    const renderer = (gl.current ??= dioramaRenderer(el))
    if (!renderer) {
      onNoWebgl()
      return
    }
    if (width === 0) {
      return
    }
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    // Why the moments live in a ref: each read rebuilds the stage, and a moment keeps playing.
    const at = performance.now() / 1000
    const cues = dioramaCuesAfter(moments.current, input, layout, at, reduced, look.pace)
    const stage = dioramaStage(renderer, {
      width,
      dark: document.documentElement.classList.contains('dark'),
      status,
      input,
      layout,
      views,
      cues,
      lite: look.quality === 'low',
      pace: look.pace,
      view: camera.view.current,
      height,
      words: {
        thisMachine: localHostDisplayLabel(),
        offline: translate('teamPanel.machines.offline', 'Offline')
      }
    })
    const draw = stage.draw
    setFitted(stage.fitted)
    let raf = 0,
      last = 0,
      visible = true
    const loop = (now: number) => {
      raf = requestAnimationFrame(loop)
      if (!visible || document.hidden || now - last < FRAME_MS) {
        return
      }
      last = now
      draw(now / 1000)
    }
    const watch = new IntersectionObserver(([entry]) => {
      visible = entry?.isIntersecting ?? true
    })
    watch.observe(el)
    // Why the clock under motion: a moment that just started must show in the very first frame.
    draw(reduced ? 1.3 : at)
    // Under reduced motion nothing animates, so a camera move paints its own still frame.
    redraw.current = reduced
      ? () => {
          camera.view.current.target = null
          draw(1.3)
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
        redraw.current?.()
        el.dataset.dioramaLit = key ?? ''
      },
      open: (key) => who.current?.get(key)?.open(),
      hold: hover.current
    })
    el.dataset.dioramaIslands = String(layout.islands.length)
    el.dataset.dioramaAdvisor = input.advisor ? 'tower' : 'none'
    el.dataset.dioramaCues = cues.map((c) => `${c.kind}:${c.key}`).join(' ')
    return () => {
      cancelAnimationFrame(raf)
      unlink()
      watch.disconnect()
      stage.dispose()
    }
  }, [layout, views, input, status, width, height, onNoWebgl, look, camera.view])

  return (
    <div ref={wrap} className="relative w-full" data-team-scene-diorama="">
      <canvas
        ref={canvas}
        role="img"
        aria-label={teamSceneLabel()}
        className="block w-full"
        data-diorama-camera={camera.mode}
      />
      <DioramaCameraButtons mode={camera.mode} setMode={camera.setMode} />
      {fitted > 0 ? (
        <TeamBuildingResizeHandle
          height={height}
          min={bounds.min}
          max={bounds.max}
          step={FIGURES_STEP}
          onResize={setWanted}
        />
      ) : null}
    </div>
  )
}
