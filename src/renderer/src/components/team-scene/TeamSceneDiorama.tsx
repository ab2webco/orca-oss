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
import {
  dioramaBoatAt,
  dioramaLeadAt,
  dioramaLeadRoundOf,
  dioramaStandOf
} from '../../../../shared/team-scene/team-diorama-lead-round'
import { dioramaActivitySpotsOf } from '../../../../shared/team-scene/team-diorama-activities'
import {
  dioramaWaterGrid,
  polyAt,
  polyLengths
} from '../../../../shared/team-scene/team-diorama-nav'
import { dioramaActivity, dioramaHomeProps, type DioramaTick } from './team-diorama-props'
import { dioramaRoadNet } from '../../../../shared/team-scene/team-diorama-roads'
import { dioramaBoat } from './team-diorama-boats'
import { teamSceneFloorsOf } from '../../../../shared/team-scene/team-scene-floors'
import { teamSceneInputOf } from '../../../../shared/team-scene/team-scene-input'
import { DAY, NIGHT, dioramaKit } from './team-diorama-kit'
import { dioramaFigure, dioramaLookOf, type DioramaFigure } from './team-diorama-figures'
import { POSE_OF_ACTION, poseDioramaFigure, type DioramaPose } from './team-diorama-poses'
import { dioramaWorld } from './team-diorama-world-meshes'
import { teamSceneLabel } from './team-scene-copy'
import { useTeamSceneStatusColors } from './team-scene-status-colors'

const VIEW = new THREE.Vector3(1, 0.88, 1).normalize()
const FRAME_MS = 1000 / 30

type Placed = { figure: DioramaFigure; pose: DioramaPose }

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
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    const el = canvas.current
    if (!el) {
      return
    }
    let renderer: THREE.WebGLRenderer
    try {
      renderer = new THREE.WebGLRenderer({ canvas: el, antialias: true })
    } catch {
      onNoWebgl()
      return
    }
    if (width === 0) {
      renderer.dispose()
      return
    }
    const dark = document.documentElement.classList.contains('dark')
    const kit = dioramaKit(dark ? NIGHT : DAY, status)
    const scene = new THREE.Scene()
    // Why π: three r155+ lights are physical; the approved prototype's (r128) were π brighter.
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
    renderer.shadowMap.enabled = true
    renderer.setClearColor(kit.p.sea)
    scene.add(new THREE.HemisphereLight(kit.p.hemiSky, kit.p.hemiGround, kit.p.hemi * Math.PI))
    const sun = new THREE.DirectionalLight(kit.p.sun, kit.p.sunI * Math.PI)
    sun.position.set(-14, 26, 10)
    sun.castShadow = true
    sun.shadow.mapSize.set(2048, 2048)
    scene.add(sun)
    const world = dioramaWorld(kit, layout, views)
    scene.add(world)

    const placed: Placed[] = []
    // The lead's round: needs-you first, then each island by boat; only roads and water.
    const lead = dioramaFigure(kit, 0, { lead: true, lite: false })
    world.add(lead.g)
    const leadScale = lead.g.scale.x
    const visitable = new Set(['build', 'inspect', 'wait', 'repair', 'cheer'])
    const round = dioramaLeadRoundOf({
      layout,
      roads: dioramaRoadNet(layout),
      water: dioramaWaterGrid(layout),
      needs: input.members.filter((m) => views.get(m.key)?.action === 'signal').map((m) => m.key),
      visits: input.members
        .filter((m) => visitable.has(views.get(m.key)?.action ?? ''))
        .map((m) => m.key),
      pace: 'normal'
    })
    const boats = Object.entries(layout.homeDocks).map(([column, dock]) => ({
      column: Number(column),
      home: dock.boat,
      boat: dioramaBoat(kit, world)
    }))
    let yaw = 0
    let lastT: number | null = null
    const moveLead = (t: number) => {
      for (const b of boats) {
        const at = dioramaBoatAt(round, b.column, b.home, t)
        b.boat.place(at.at, at.heading, t, at.moving)
      }
      const at = dioramaLeadAt(round, t)
      lead.g.position.x = at.at[0]
      lead.g.position.z = at.at[1]
      lead.baseY = at.pose === 'sit' ? -0.6 : 0
      lead.g.scale.setScalar(leadScale * at.blink)
      // Why eased: a snapped turn reads as a jump; it turns toward its heading over a few frames.
      if (at.heading && Math.hypot(at.heading[0], at.heading[1]) > 1e-6) {
        const goal = Math.atan2(at.heading[0], at.heading[1])
        const dt = lastT === null ? 1 : Math.min(0.1, Math.max(0, t - lastT))
        yaw += (((goal - yaw + Math.PI * 3) % (Math.PI * 2)) - Math.PI) * Math.min(1, dt * 7)
        lead.g.rotation.y = yaw
      }
      lastT = t
      poseDioramaFigure(lead, at.pose === 'talk' ? 'idle' : at.pose, t)
    }
    const ticks: DioramaTick[] = dioramaHomeProps(kit, world)
    const spots = new Map(dioramaActivitySpotsOf(layout, views).map((spot) => [spot.key, spot]))
    const SPOT_POSE = { fish: 'fish', chop: 'chop', rest: 'sit', farm: 'water' } as const
    for (const island of layout.islands) {
      for (const plot of island.plots) {
        const view = plot.key ? views.get(plot.key) : undefined
        if (!view || view.action === 'gone' || view.action === 'start') {
          continue
        }
        const member = input.members.find((m) => m.key === plot.key)!
        const f = dioramaFigure(kit, dioramaLookOf(member.characterKey ?? member.key), {
          lite: false
        })
        const spot = spots.get(member.key)
        if (spot) {
          // A free or resting member leaves its plot for its spot; the plot keeps its build.
          f.g.position.set(spot.at[0], 0, spot.at[1])
          f.g.rotation.y = Math.atan2(spot.face[0] - spot.at[0], spot.face[1] - spot.at[1])
          world.add(f.g)
          const tick = dioramaActivity(kit, spot, f, world)
          if (tick) {
            ticks.push(tick)
          }
          if (spot.loop) {
            const loop = [...spot.loop, spot.loop[0]!]
            const cum = polyLengths(loop)
            const phase = (spot.phase ?? 0) * cum.at(-1)!
            ticks.push((t) => {
              const at = polyAt(loop, cum, (t * 0.45 + phase) % cum.at(-1)!)
              f.g.position.set(at.at[0], f.g.position.y, at.at[1])
              f.g.rotation.y = Math.atan2(at.heading[0], at.heading[1])
            })
          }
          placed.push({ figure: f, pose: SPOT_POSE[spot.kind] })
          continue
        }
        const [x, z] = dioramaStandOf(plot)
        f.g.position.set(x, 0, z)
        f.g.rotation.y =
          Math.atan2(plot.x - x, plot.z - z) +
          (view.action === 'signal' || view.action === 'cheer' ? Math.PI : 0)
        world.add(f.g)
        placed.push({ figure: f, pose: POSE_OF_ACTION[view.action] })
      }
    }

    // Fit the whole world: project every mesh's box into the camera's view.
    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 400)
    camera.position.copy(VIEW).multiplyScalar(80)
    camera.lookAt(0, 0, 0)
    camera.updateMatrixWorld()
    const box = new THREE.Box3()
    world.updateMatrixWorld(true)
    world.traverse((o) => {
      const m = o as THREE.Mesh
      if (m.geometry && m.geometry.type !== 'PlaneGeometry') {
        box.expandByObject(m)
      }
    })
    const corners = [box.min.x, box.max.x].flatMap((x) =>
      [box.min.y, box.max.y].flatMap((y) =>
        [box.min.z, box.max.z].map((z) =>
          new THREE.Vector3(x, y, z).applyMatrix4(camera.matrixWorldInverse)
        )
      )
    )
    const xs = corners.map((v) => v.x),
      ys = corners.map((v) => v.y)
    const fw = Math.max(...xs) - Math.min(...xs) + 1.6,
      fh = Math.max(...ys) - Math.min(...ys) + 1.6
    const height = Math.round(Math.max(240, Math.min(width * (fh / fw), 520)))
    renderer.setSize(width, height, true)
    const aspect = width / height
    const half =
      fw / 2 / aspect > fh / 2
        ? { w: fw / 2, h: fw / 2 / aspect }
        : { w: (fh / 2) * aspect, h: fh / 2 }
    Object.assign(camera, { left: -half.w, right: half.w, top: half.h, bottom: -half.h })
    const center = new THREE.Vector3(
      (Math.max(...xs) + Math.min(...xs)) / 2,
      (Math.max(...ys) + Math.min(...ys)) / 2,
      0
    )
    const target = new THREE.Vector3()
      .setFromMatrixColumn(camera.matrixWorld, 0)
      .multiplyScalar(center.x)
      .add(new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 1).multiplyScalar(center.y))
    camera.position.copy(target).add(VIEW.clone().multiplyScalar(80))
    camera.lookAt(target)
    camera.updateProjectionMatrix()

    const draw = (t: number) => {
      moveLead(t)
      for (const tick of ticks) {
        tick(t)
      }
      for (const p of placed) {
        poseDioramaFigure(p.figure, p.pose, t)
      }
      renderer.render(scene, camera)
    }
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
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
    const seen = new IntersectionObserver(([entry]) => {
      visible = entry?.isIntersecting ?? true
    })
    seen.observe(el)
    draw(1.3)
    if (!reduced) {
      raf = requestAnimationFrame(loop)
    }
    el.dataset.dioramaIslands = String(layout.islands.length)
    return () => {
      cancelAnimationFrame(raf)
      seen.disconnect()
      kit.dispose(world)
      renderer.dispose()
    }
  }, [layout, views, input, status, width, onNoWebgl])

  return (
    <div ref={wrap} className="w-full" data-team-scene-diorama="">
      <canvas ref={canvas} role="img" aria-label={teamSceneLabel()} className="block w-full" />
    </div>
  )
}
