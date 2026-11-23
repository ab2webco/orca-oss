// @vitest-environment happy-dom

import { act, cleanup, fireEvent, render, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { TeamSceneActor } from '../../../../shared/team-scene/team-scene-types'
import { TeamBuildingResizeHandle } from './TeamBuildingResizeHandle'
import {
  teamSceneActorBox,
  teamSceneMemberAt,
  useTeamSceneHover,
  useTeamSceneHoverRow
} from './team-scene-hit'
import type { TeamScenePainter } from './team-scene-painter'
import { teamBuildingHeightOf, useTeamBuildingHeight } from './use-team-building-height'
import { useTeamScenePointer } from './use-team-scene-pointer'

const W = 400
const H = 176
// Feet 36 px over the bottom plus depth; heads 60 px above them, as Office and Figures draw.
const PAINTER = {
  height: H,
  headTop: (depth: number, h: number) => h - 96 + depth * 22,
  feetAt: (depth: number, h: number) => h - 36 + depth * 22
} as unknown as TeamScenePainter

const actor = (key: string, x: number, depth = 0.55, role: TeamSceneActor['role'] = 'member') =>
  ({
    key,
    role,
    name: key,
    characterKey: null,
    x,
    depth,
    facing: 1,
    pose: 'idle',
    gait: 0,
    stride: 8,
    carrying: false,
    emote: null,
    jump: 0
  }) as TeamSceneActor
const boxOf = (a: TeamSceneActor) => teamSceneActorBox(a, PAINTER, W, H)

afterEach(() => {
  cleanup()
  useTeamSceneHover.setState({ key: null })
  window.localStorage.clear()
})

// ORCA-1219: characters were told apart by shirt colour alone.
describe('team scene hit-testing', () => {
  it('bounds a figure from its head to its feet, about a body wide, at its x', () => {
    const box = boxOf(actor('a', 0.5))
    expect(box.top).toBeCloseTo(PAINTER.headTop(0.55, H))
    expect(box.top + box.height).toBeCloseTo(PAINTER.feetAt!(0.55, H))
    expect(box.left + box.width / 2).toBeCloseTo(200)
    expect(box.width).toBeGreaterThan(20)
    expect(box.width).toBeLessThan(box.height)
  })

  it('finds the member under the point, the front one where two overlap, and never the lead', () => {
    const back = actor('back', 0.5, 0.3)
    const front = actor('front', 0.52, 0.85)
    const lead = actor('lead', 0.8, 0.45, 'lead')
    const actors = [back, front, lead]
    const feet = PAINTER.feetAt!(0.3, H)
    expect(teamSceneMemberAt(actors, { x: 202, y: feet - 10 }, boxOf)).toBe('front')
    expect(teamSceneMemberAt(actors, { x: 200, y: PAINTER.headTop(0.3, H) + 2 }, boxOf)).toBe(
      'back'
    )
    expect(teamSceneMemberAt(actors, { x: 320, y: feet - 10 }, boxOf)).toBeNull()
    expect(teamSceneMemberAt(actors, { x: 40, y: feet - 10 }, boxOf)).toBeNull()
  })
})

describe('pointing at a member in the scene', () => {
  const setup = () => {
    const open = vi.fn()
    const canvas = document.createElement('canvas')
    canvas.getBoundingClientRect = () => ({ left: 10, top: 20, width: W, height: H }) as DOMRect
    const members = new Map([['a', { title: 'Mario', detail: 'ORCA-1 · Working', open }]])
    const { result } = renderHook(() =>
      useTeamScenePointer({
        canvasRef: { current: canvas },
        actorsRef: { current: [actor('a', 0.5)] },
        painter: PAINTER,
        members
      })
    )
    const over = { clientX: 10 + 200, clientY: 20 + PAINTER.feetAt!(0.55, H) - 10 }
    return { result, open, over }
  }

  it('lights the member it hovers, lets it go on leaving, and opens it on a click', () => {
    const { result, open, over } = setup()
    act(() =>
      result.current!.handlers.onPointerMove({
        ...over,
        pointerType: 'mouse'
      } as React.PointerEvent)
    )
    expect(useTeamSceneHover.getState().key).toBe('a')
    act(() => result.current!.handlers.onClick(over as React.MouseEvent))
    expect(open).toHaveBeenCalledOnce()
    act(() => result.current!.handlers.onPointerLeave())
    expect(useTeamSceneHover.getState().key).toBeNull()
  })

  it('keeps a member lit from the Team list when the pointer crosses the stage', () => {
    const { result } = setup()
    act(() => useTeamSceneHover.getState().set('row'))
    act(() =>
      result.current!.handlers.onPointerMove({
        clientX: 0,
        clientY: 0,
        pointerType: 'mouse'
      } as React.PointerEvent)
    )
    act(() => result.current!.handlers.onPointerLeave())
    expect(useTeamSceneHover.getState().key).toBe('row')
  })

  it('shows the label on a long press without opening the member', () => {
    vi.useFakeTimers()
    const { result, open, over } = setup()
    act(() =>
      result.current!.handlers.onPointerDown({
        ...over,
        pointerType: 'touch'
      } as React.PointerEvent)
    )
    act(() => vi.advanceTimersByTime(600))
    expect(useTeamSceneHover.getState().key).toBe('a')
    act(() => result.current!.handlers.onClick(over as React.MouseEvent))
    expect(open).not.toHaveBeenCalled()
    vi.useRealTimers()
  })
})

// ORCA-1336: the 3D scenes key the lead's and the advisor's figures so; their rows join the link.
describe('a Team row in the hover link', () => {
  afterEach(() => act(() => useTeamSceneHover.getState().set(null)))

  it.each(['lead', 'advisor', 'pane-a'])('lights figure %s on hover and is lit by it', (key) => {
    const { result } = renderHook(() => useTeamSceneHoverRow(key))
    expect(result.current.lit).toBe(false)
    act(() => result.current.rowProps.onPointerEnter())
    expect(useTeamSceneHover.getState().key).toBe(key)
    expect(result.current.lit).toBe(true)
    expect(result.current.rowProps['data-team-card-lit']).toBe('')
    act(() => result.current.rowProps.onPointerLeave())
    expect(useTeamSceneHover.getState().key).toBeNull()
    // A figure pointed at in the scene lights the row; leaving another row keeps it.
    act(() => useTeamSceneHover.getState().set(key))
    expect(result.current.lit).toBe(true)
  })
})

describe('the building height', () => {
  const bounds = { min: 348, max: 580 }

  it('opens at its minimum and clamps any height to the floors there are', () => {
    expect(teamBuildingHeightOf(null, bounds)).toBe(348)
    expect(teamBuildingHeightOf(9000, bounds)).toBe(580)
    expect(teamBuildingHeightOf(10, bounds)).toBe(348)
    expect(teamBuildingHeightOf(400, bounds)).toBe(400)
  })

  it('keeps the dragged height on this machine and forgets it on a reset', () => {
    const first = renderHook(() => useTeamBuildingHeight())
    act(() => first.result.current[1](464))
    expect(renderHook(() => useTeamBuildingHeight()).result.current[0]).toBe(464)
    act(() => first.result.current[1](null))
    expect(renderHook(() => useTeamBuildingHeight()).result.current[0]).toBeNull()
  })

  it('resizes from the keyboard a floor at a time and resets on a double click', () => {
    const onResize = vi.fn()
    const { getByRole } = render(
      <TeamBuildingResizeHandle height={348} min={348} max={580} step={116} onResize={onResize} />
    )
    const handle = getByRole('separator')
    expect(handle.getAttribute('aria-valuenow')).toBe('348')
    fireEvent.keyDown(handle, { key: 'ArrowDown' })
    expect(onResize).toHaveBeenLastCalledWith(464)
    fireEvent.keyDown(handle, { key: 'ArrowUp' })
    expect(onResize).toHaveBeenLastCalledWith(348)
    fireEvent.keyDown(handle, { key: 'End' })
    expect(onResize).toHaveBeenLastCalledWith(580)
    fireEvent.doubleClick(handle)
    expect(onResize).toHaveBeenLastCalledWith(null)
  })
})
