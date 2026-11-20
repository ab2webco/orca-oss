import React, { useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import type { TeamPanelGameModel } from '../../../../shared/team-panel-model-types'
import {
  dioramaPlotViewOf,
  type DioramaPlotView
} from '../../../../shared/team-scene/team-diorama-actions'
import {
  teamDioramaLayoutOf,
  teamDioramaMachinesOf,
  type DioramaOrder
} from '../../../../shared/team-scene/team-diorama-layout'
import { teamSceneFloorsOf } from '../../../../shared/team-scene/team-scene-floors'
import { teamSceneInputOf } from '../../../../shared/team-scene/team-scene-input'
import { dioramaStage } from './team-diorama-stage'
import { teamSceneLabel } from './team-scene-copy'
import { useTeamSceneStatusColors } from './team-scene-status-colors'

const FRAME_MS = 1000 / 30

/** Figures as the 3D diorama (ORCA-1296): one island per machine, each member at its own plot. */
export function TeamSceneDiorama({
  model,
  onNoWebgl
}: {
  model: TeamPanelGameModel
  /** Without WebGL (hardware acceleration off) the panel draws the 2D Figures instead. */
  onNoWebgl: () => void
}): React.JSX.Element {
  const wrap = useRef<HTMLDivElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const order = useRef<DioramaOrder | undefined>(undefined)
  const gl = useRef<THREE.WebGLRenderer | null>(null)
  const status = useTeamSceneStatusColors()
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
  const views = useMemo(() => {
    const out = new Map<string, DioramaPlotView>()
    let idle = 0
    for (const m of input.members) {
      const view = dioramaPlotViewOf(m, idle)
      if (view.action === 'idle') {
        idle += 1
      }
      out.set(m.key, view)
    }
    return out
  }, [input])

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
    let renderer = gl.current
    if (!renderer) {
      try {
        renderer = gl.current = new THREE.WebGLRenderer({ canvas: el, antialias: true })
      } catch {
        onNoWebgl()
        return
      }
    }
    if (width === 0) {
      return
    }
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const stage = dioramaStage(renderer, {
      width,
      dark: document.documentElement.classList.contains('dark'),
      status,
      input,
      layout,
      views
    })
    const draw = stage.draw
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
    draw(1.3)
    if (!reduced) {
      raf = requestAnimationFrame(loop)
    }
    el.dataset.dioramaIslands = String(layout.islands.length)
    return () => {
      cancelAnimationFrame(raf)
      watch.disconnect()
      stage.dispose()
    }
  }, [layout, views, input, status, width, onNoWebgl])

  return (
    <div ref={wrap} className="w-full" data-team-scene-diorama="">
      <canvas ref={canvas} role="img" aria-label={teamSceneLabel()} className="block w-full" />
    </div>
  )
}
