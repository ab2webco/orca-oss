// @vitest-environment happy-dom

import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { TeamSceneInput } from '../../../../shared/team-scene/team-scene-types'
import { TeamSceneCanvas } from './TeamSceneCanvas'
import type { TeamSceneFrame, TeamScenePainter } from './team-scene-painter'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const lead = { key: 'lead', name: 'Lead', characterKey: null, activity: 'working' } as const
const member = (key: string) =>
  ({
    key,
    name: key,
    characterKey: null,
    activity: 'working',
    reportId: null,
    mergedPr: null,
    site: { stage: 0, broken: false }
  }) as const
const input = (keys: string[], advisorLine?: string): TeamSceneInput => ({
  lead,
  advisor: advisorLine === undefined ? null : { line: advisorLine },
  members: keys.map(member)
})

function painter() {
  const frames: TeamSceneFrame[] = []
  const value: TeamScenePainter = {
    height: 176,
    headTop: () => 100,
    paint: (_g, frame) => frames.push(frame),
    dispose: vi.fn()
  }
  return { value, frames }
}

let root: Root
let host: HTMLDivElement
let hidden = false
let reduced = false

const render = (node: React.ReactElement): void => {
  act(() => root.render(node))
}

beforeEach(() => {
  hidden = false
  reduced = false
  vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() =>
    hidden ? 'hidden' : 'visible'
  )
  vi.spyOn(window, 'matchMedia').mockImplementation(
    (query) =>
      ({
        matches: reduced,
        media: query,
        addEventListener() {},
        removeEventListener() {}
      }) as unknown as MediaQueryList
  )
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(360)
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
    setTransform() {},
    clearRect() {},
    fillRect() {}
  } as unknown as CanvasRenderingContext2D)
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
  vi.restoreAllMocks()
})

describe('TeamSceneCanvas', () => {
  it('draws an image labelled for screen readers', () => {
    render(<TeamSceneCanvas input={input([])} painter={painter().value} leadLine={null} />)
    const canvas = host.querySelector('canvas')!
    expect(canvas.getAttribute('role')).toBe('img')
    // Named through translate(), so it follows the UI language.
    expect(canvas.getAttribute('aria-label')).toBe('Live team scene')
  })

  it('animates only while the window is visible', () => {
    hidden = true
    const raf = vi.spyOn(window, 'requestAnimationFrame').mockReturnValue(1)
    render(<TeamSceneCanvas input={input(['a'])} painter={painter().value} leadLine={null} />)
    expect(raf).not.toHaveBeenCalled()
    hidden = false
    act(() => document.dispatchEvent(new Event('visibilitychange')))
    expect(raf).toHaveBeenCalled()
  })

  // ORCA-1097: at the 3.5 frames/s a slow renderer paints, capped steps would slow idle motion
  // to a sixth of real time; idle sway follows real seconds while walks stay capped.
  it('keys idle motion to real seconds, not the capped step, when frames are sparse', () => {
    let next: FrameRequestCallback | null = null
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
      next = cb
      return 1
    })
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {})
    const p = painter()
    render(<TeamSceneCanvas input={input(['a'])} painter={p.value} leadLine={null} />)
    for (const now of [0, 285, 570, 855]) {
      act(() => next?.(now))
    }
    const [first, , , last] = p.frames.slice(-4)
    expect(last!.t - first!.t).toBeCloseTo(0.855, 2)
    expect(last!.dt).toBe(0.05)
  })

  // Why: the lead walks its rounds, and its bubble must go with it, not wait at its spot.
  it("moves the lead's bubble with the lead as it walks to a member who needs you", () => {
    let next: FrameRequestCallback | null = null
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
      next = cb
      return 1
    })
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {})
    // Why sized: happy-dom lays nothing out, and a zero-wide bubble has no spot for its tail.
    vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(60)
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(20)
    const asking = input(['n'])
    asking.members[0] = { ...asking.members[0]!, activity: 'needsYou' }
    render(<TeamSceneCanvas input={asking} painter={painter().value} leadLine="Busy" />)
    const left = () =>
      Number.parseFloat(host.querySelector<HTMLElement>('[data-scene-bubble="lead"]')!.style.left)
    act(() => next?.(0))
    const before = left()
    for (let now = 50; now < 8000; now += 50) {
      act(() => next?.(now))
    }
    expect(Math.abs(left() - before)).toBeGreaterThan(20)
  })

  // Why: a spec that crops the lead must find it; on its rounds it leaves its spot (run 42982825235).
  it('says where the lead stands, as a share of the stage, and follows it as it walks', () => {
    let next: FrameRequestCallback | null = null
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
      next = cb
      return 1
    })
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {})
    const asking = input(['n'])
    asking.members[0] = { ...asking.members[0]!, activity: 'needsYou' }
    render(<TeamSceneCanvas input={asking} painter={painter().value} leadLine={null} />)
    const leadX = () =>
      Number(host.querySelector<HTMLElement>('[data-scene-lead-x]')?.dataset.sceneLeadX)
    act(() => next?.(0))
    expect(leadX()).toBeCloseTo(0.84, 1)
    for (let now = 50; now < 8000; now += 50) {
      act(() => next?.(now))
    }
    expect(leadX()).toBeLessThan(0.5)
  })

  it("seats the team as the painter's style lays it out", () => {
    reduced = true
    vi.spyOn(window, 'requestAnimationFrame').mockReturnValue(1)
    const keys = ['a', 'b', 'c', 'd', 'e']
    const ground = painter()
    render(<TeamSceneCanvas input={input(keys)} painter={ground.value} leadLine={null} />)
    expect(new Set(ground.frames.at(-1)!.stations.map((s) => s.depth)).size).toBe(2)
    const desks = painter()
    const seated = { ...desks.value, layout: { rowSize: 5, workSeated: true } }
    render(<TeamSceneCanvas input={input(keys)} painter={seated} leadLine={null} />)
    expect(new Set(desks.frames.at(-1)!.stations.map((s) => s.depth)).size).toBe(1)
  })

  it('paints the settled end state once per change under reduced motion', () => {
    reduced = true
    const raf = vi.spyOn(window, 'requestAnimationFrame').mockReturnValue(1)
    const p = painter()
    render(<TeamSceneCanvas input={input(['a'])} painter={p.value} leadLine={null} />)
    render(<TeamSceneCanvas input={input(['a', 'n'])} painter={p.value} leadLine={null} />)
    expect(raf).not.toHaveBeenCalled()
    expect(p.frames).toHaveLength(2)
    const newcomer = p.frames[1].actors.find((a) => a.key === 'n')!
    // Seated on stage, not queued off it at x < 0.
    expect(newcomer.pose).toBe('work')
    expect(newcomer.x).toBeGreaterThan(0)
  })

  it('paints the end of a ride under reduced motion: the away lead gone, the guest by its member', () => {
    reduced = true
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(420)
    const home = painter()
    render(
      <TeamSceneCanvas
        input={{ ...input(['a']), leadStays: true, ride: 'away' }}
        painter={home.value}
        leadLine={null}
      />
    )
    expect(home.frames.at(-1)!.actors.some((a) => a.key === 'lead')).toBe(false)
    act(() => root.unmount())
    root = createRoot(host)
    const there = painter()
    const floor = { ...input(['b']), leadless: true as const }
    floor.members[0] = { ...floor.members[0]!, activity: 'needsYou' }
    render(
      <TeamSceneCanvas
        input={{ ...floor, ride: { guest: 'b' } }}
        painter={there.value}
        leadLine={null}
      />
    )
    const frame = there.frames.at(-1)!
    const guest = frame.actors.find((a) => a.key === 'lead')
    const b = frame.actors.find((a) => a.key === 'b')!
    expect(Math.abs(guest!.x - b.x)).toBeLessThan(0.12)
  })

  it('ties the lead line to the lead', () => {
    reduced = true
    render(
      <TeamSceneCanvas input={input(['a'])} painter={painter().value} leadLine="Reviewing #923" />
    )
    act(() => {})
    expect(host.querySelector('[data-scene-bubble="lead"]')?.textContent).toBe('Reviewing #923')
  })

  it('tags a member who needs the user with its name over the alert, as V28 does', () => {
    reduced = true
    const asking: TeamSceneInput = {
      ...input(['a']),
      members: [{ ...member('h'), name: 'Herrero', activity: 'needsYou' }, member('a')]
    }
    render(<TeamSceneCanvas input={asking} painter={painter().value} leadLine={null} />)
    act(() => {})
    const tags = [...host.querySelectorAll('[data-scene-speaker]')]
    expect(tags.map((one) => [one.getAttribute('data-scene-speaker'), one.textContent])).toEqual([
      ['h', 'Herrero']
    ])
    // Above the head and its alert mark, never over the speaker's face.
    expect(Number.parseFloat((tags[0] as HTMLElement).style.top)).toBeLessThan(100 - 16)
  })

  it('hangs the name tag over the alert wherever the style draws it', () => {
    reduced = true
    const asking: TeamSceneInput = {
      ...input([]),
      members: [{ ...member('h'), name: 'Herrero', activity: 'needsYou' }]
    }
    const beside = { ...painter().value, emoteAt: () => ({ x: 150, y: 120 }) }
    render(<TeamSceneCanvas input={asking} painter={beside} leadLine={null} />)
    act(() => {})
    const tag = host.querySelector('[data-scene-speaker="h"]') as HTMLElement
    expect(Number.parseFloat(tag.style.left)).toBe(150)
    expect(Number.parseFloat(tag.style.top)).toBeLessThan(120 - 7 - 16)
    expect(Number.parseFloat(tag.style.top)).toBeGreaterThan(120 - 40)
  })

  it("draws Pixel's thought cloud instead of the glass bubble", () => {
    reduced = true
    // happy-dom has no layout; a measured bubble is what lets the layout place it.
    vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(120)
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(30)
    const cloudy = { ...painter().value, cloudPixel: 3 }
    render(<TeamSceneCanvas input={input(['a'])} painter={cloudy} leadLine="Merge?" />)
    const bubble = host.querySelector('[data-scene-bubble="lead"]')!
    expect(bubble.querySelector('canvas')).not.toBeNull()
    expect(bubble.className).toContain('font-mono')
    render(<TeamSceneCanvas input={input(['a'])} painter={painter().value} leadLine="Merge?" />)
    expect(host.querySelector('[data-scene-bubble="lead"] canvas')).toBeNull()
  })

  it('fades the advisor line after six seconds even without frames', () => {
    vi.useFakeTimers()
    reduced = true
    const p = painter()
    render(<TeamSceneCanvas input={input([], 'first')} painter={p.value} leadLine={null} />)
    render(<TeamSceneCanvas input={input([], 'Raised effort')} painter={p.value} leadLine={null} />)
    expect(host.querySelector('[data-scene-bubble="advisor"]')?.textContent).toBe('Raised effort')
    act(() => vi.advanceTimersByTime(5900))
    expect(host.querySelector('[data-scene-bubble="advisor"]')).not.toBeNull()
    act(() => vi.advanceTimersByTime(200))
    expect(host.querySelector('[data-scene-bubble="advisor"]')).toBeNull()
    vi.useRealTimers()
  })

  it('fades the advisor line after six real seconds on a runner at 3.5 frames a second', () => {
    let pending: FrameRequestCallback[] = []
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => pending.push(cb))
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {})
    const p = painter()
    render(<TeamSceneCanvas input={input([], 'first')} painter={p.value} leadLine={null} />)
    render(<TeamSceneCanvas input={input([], 'Raised effort')} painter={p.value} leadLine={null} />)
    let now = 0
    const runUntil = (ms: number): void => {
      for (; now <= ms; now += 1000 / 3.5) {
        const due = pending
        pending = []
        act(() => due.forEach((cb) => cb(now)))
      }
    }
    runUntil(5700)
    expect(host.querySelector('[data-scene-bubble="advisor"]')?.textContent).toBe('Raised effort')
    runUntil(6300)
    expect(host.querySelector('[data-scene-bubble="advisor"]')).toBeNull()
  })

  it('releases the canvas, the frame and the painter on close', () => {
    vi.spyOn(window, 'requestAnimationFrame').mockReturnValue(7)
    const cancel = vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {})
    const p = painter()
    render(<TeamSceneCanvas input={input(['a'])} painter={p.value} leadLine={null} />)
    const canvas = host.querySelector('canvas')!
    act(() => root.unmount())
    expect(cancel).toHaveBeenCalledWith(7)
    expect(p.value.dispose).toHaveBeenCalled()
    expect([canvas.width, canvas.height]).toEqual([0, 0])
    root = createRoot(host)
  })
})
