// @vitest-environment happy-dom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  TeamHost,
  TeamLeadCard,
  TeamMachine,
  TeamMemberCard
} from '../../../../shared/team-panel-model-types'
import { TeamSceneBuilding, type TeamSceneBuildingModel } from './TeamSceneBuilding'
import type { TeamScenePainter } from './team-scene-painter'
import { recordingContext } from './team-scene-recording-context'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const local: TeamHost = { kind: 'local' }
const remote = (name: string, reachable = true): TeamHost => ({
  kind: 'remote',
  name,
  environmentId: `env-${name}`,
  reachable
})
const facts = {
  terminalHandle: null,
  worktreeId: null,
  agentType: 'claude',
  status: 'working' as const,
  condition: 'working' as const,
  since: null,
  liveAction: null,
  model: null,
  account: null
}
const lead: TeamLeadCard = {
  ...facts,
  paneKey: 'lead',
  host: local,
  name: 'Lead',
  characterKey: null,
  branch: null,
  ownerAsk: null
}
const card = (paneKey: string, host: TeamHost): TeamMemberCard => ({
  ...facts,
  paneKey,
  host,
  name: paneKey,
  characterKey: null,
  ticket: null,
  flowPhase: 'code',
  summary: null,
  pr: null,
  needsYou: false,
  limitResetsAt: null,
  found: false
})
const machine = (host: TeamHost, cap: number, running: number): TeamMachine => ({
  host,
  running,
  cap,
  status: 'working',
  reading:
    host.kind === 'remote' && !host.reachable
      ? { kind: 'unreachable', lastSeenAt: null }
      : { kind: 'unread' }
})
const model = (hosts: TeamHost[]): TeamSceneBuildingModel => ({
  lead,
  advisor: null,
  stopped: null,
  queue: null,
  members: hosts.map((host, i) => card(`m${i}`, host)),
  machines: { kind: 'ready', value: hosts.map((host) => machine(host, 4, 1)) }
})
const painter = (): TeamScenePainter => ({
  height: 176,
  headTop: () => 40,
  paint: () => {},
  dispose: () => {}
})

let root: Root
let host: HTMLDivElement
const make = vi.fn(painter)
const render = (hosts: TeamHost[]) =>
  act(() =>
    root.render(<TeamSceneBuilding model={model(hosts)} makePainter={make} leadLine={null} />)
  )
const floors = () =>
  [...host.querySelectorAll<HTMLElement>('[data-team-floor]')].map((f) => f.dataset.teamFloor)
const button = (label: string) =>
  [...host.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent === label)!
const region = () => host.querySelector<HTMLElement>('[data-team-building]')!
const key = (target: EventTarget, k: string) =>
  act(() => {
    target.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true }))
  })

beforeEach(() => {
  vi.spyOn(window, 'matchMedia').mockImplementation(
    (query) =>
      ({
        matches: true,
        media: query,
        addEventListener() {},
        removeEventListener() {}
      }) as unknown as MediaQueryList
  )
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(420)
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => recordingContext().g)
  make.mockClear()
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
  vi.restoreAllMocks()
})

describe('TeamSceneBuilding', () => {
  it("stacks one floor per machine, the lead's at the bottom, each with its own painter", () => {
    render([local, remote('imac'), remote('m1')])
    expect(floors()).toEqual(['m1', 'imac', ''])
    expect(make).toHaveBeenCalledTimes(3)
  })

  // Why every floor: an owner with five machines saw three and a '+2' (owner, 2026-11-11).
  it('draws one floor per machine, none folded, in a building that scrolls at three floors high', () => {
    const hosts = [local, remote('a'), remote('b'), remote('c'), remote('d')]
    render(hosts)
    expect(floors()).toHaveLength(5)
    expect(host.textContent).not.toMatch(/\+\d/)
    for (const name of ['This computer', 'a', 'b', 'c', 'd']) {
      expect(button(name)).toBeTruthy()
    }
    const scroller = host.querySelector<HTMLElement>('[data-team-floors-scroll]')!
    expect(scroller.className).toContain('overflow-y-auto')
    // Three strips and their slabs: the building's height before every floor was shown.
    expect(scroller.style.maxHeight).toBe(`${3 * (112 + 4)}px`)
  })

  // Why: the scroller's top is what is above a floor scrolled to it, and a bubble there was cut
  // (the owner's 'detrás del muro', again at the scroller's edge; lead, 2026-11-11).
  it("keeps each floor's bubbles under the scroller's visible top as it scrolls", () => {
    render([local, remote('a'), remote('b'), remote('c'), remote('d')])
    const scroller = host.querySelector<HTMLElement>('[data-team-floors-scroll]')!
    const tops = () =>
      [...host.querySelectorAll<HTMLElement>('[data-team-floor]')].map((floor) => {
        const crop = Number(
          /^inset\((\d+)px/.exec(floor.querySelector('canvas')!.style.clipPath)![1]
        )
        const top = Number(
          floor.querySelector<HTMLElement>('[data-scene-visible-top]')!.dataset.sceneVisibleTop
        )
        return { crop, top }
      })
    // Unscrolled: the top floor keeps under its own crop, the rest may rise over the slab.
    expect(tops().map((one) => one.top)).toEqual([tops()[0]!.crop, 0, 0, 0, 0])
    scroller.scrollTop = 200
    act(() => scroller.dispatchEvent(new Event('scroll')))
    // Floor i starts at i * 116 in the scroller: the visible top is 200 - that, past its crop.
    expect(tops().map((one) => one.top)).toEqual(
      tops().map((one, i) => Math.max(0, one.crop + 200 - i * 116))
    )
  })

  it("opens on the floor that matters: one where a member needs you, else the lead's", () => {
    const seen: string[] = []
    vi.spyOn(HTMLElement.prototype, 'scrollIntoView').mockImplementation(
      function (this: HTMLElement) {
        seen.push(this.dataset.teamFloor ?? '?')
      }
    )
    const hosts = [local, remote('a'), remote('b'), remote('c'), remote('d')]
    render(hosts)
    expect(seen.at(-1)).toBe('')
    act(() => root.unmount())
    root = createRoot(host)
    const asking = model(hosts)
    asking.members[3] = { ...asking.members[3]!, needsYou: true }
    act(() => root.render(<TeamSceneBuilding model={asking} makePainter={make} leadLine={null} />))
    expect(seen.at(-1)).toBe('c')
  })

  it('zooms to a floor from its button or its number key, and back with All or Escape', () => {
    render([local, remote('imac'), remote('m1')])
    act(() => button('imac').click())
    expect(floors()).toEqual(['imac'])
    expect(button('imac').getAttribute('aria-pressed')).toBe('true')
    key(region(), 'Escape')
    expect(floors()).toEqual(['m1', 'imac', ''])
    key(region(), '3')
    expect(floors()).toEqual(['m1'])
    act(() => button('All').click())
    expect(floors()).toHaveLength(3)
  })

  it('takes its keys only from inside the scene, never from the terminals beside it', () => {
    render([local, remote('imac')])
    key(window, '2')
    key(document.body, '2')
    expect(floors()).toEqual(['imac', ''])
  })

  it('darkens the floor of a machine it cannot reach, and nothing says so in words', () => {
    render([local, remote('m1', false)])
    const dark = host.querySelector('[data-team-floor="m1"]')!
    expect(dark.hasAttribute('data-team-floor-dark')).toBe(true)
    expect(dark.textContent).not.toMatch(/offline/i)
    expect(host.querySelector('[data-team-floor=""]')!.hasAttribute('data-team-floor-dark')).toBe(
      false
    )
  })

  it("names each floor on a plate in its own button's words, and gives higher floors more sky", () => {
    render([local, remote('imac'), remote('m1')])
    const plates = [...host.querySelectorAll<HTMLElement>('[data-team-floor-plate]')].map(
      (p) => p.textContent
    )
    expect(plates).toEqual(['m1', 'imac', 'This computer'])
    // Why the crop: the top floor shows more sky than the lead's street-level floor.
    const crops = [...host.querySelectorAll<HTMLElement>('[data-team-floor-view]')].map((v) =>
      Number.parseFloat(v.style.marginTop)
    )
    expect(crops[0]!).toBeGreaterThan(crops[2]!)
  })

  // Why: Blink memory grew ~120 MB/min with the building shown (2026-11-11); a poll hands a new
  // model each time, and nothing it draws may pile up or remake its painters.
  it('keeps its DOM and painters flat across many polls, reports and rides included', () => {
    vi.useFakeTimers()
    const hosts = [local, remote('imac'), remote('m1')]
    render(hosts)
    const nodes = host.querySelectorAll('*').length
    const painters = make.mock.calls.length
    for (let poll = 0; poll < 300; poll++) {
      const next = model(hosts)
      next.members[1] = {
        ...next.members[1]!,
        summary: `Report ${poll}`,
        needsYou: poll % 2 === 0,
        decisions: [{ id: `d${poll}`, verdict: 'allow', gesture: null }]
      }
      act(() => root.render(<TeamSceneBuilding model={next} makePainter={make} leadLine={null} />))
      act(() => vi.advanceTimersByTime(20_000))
    }
    expect(make.mock.calls.length).toBe(painters)
    expect(host.querySelectorAll('*').length).toBe(nodes)
    vi.useRealTimers()
  })

  // Why: a floor's speech bubble was cut under the floor above ('Los mensajes quedan detrás del
  // muro', owner, 2026-11-11). Only the canvas is cropped; bubbles may rise over the slab above.
  it("crops each floor's canvas, not its bubbles, and keeps the top floor's under its own top", () => {
    render([local, remote('imac'), remote('m1')])
    const floorsShown = [...host.querySelectorAll<HTMLElement>('[data-team-floor]')]
    expect(floorsShown).toHaveLength(3)
    for (const [i, floor] of floorsShown.entries()) {
      expect(floor.className, 'the floor itself clips nothing').not.toContain('overflow-hidden')
      // Why flow-root: without a block context of its own, the view's negative margin collapses
      // through the floor and lifts it over the floor above (seen in the building E2E).
      expect(floor.className).toContain('flow-root')
      // Why: the view reaches over the floor above and the nav; it must never take their clicks.
      expect(floor.querySelector('[data-team-floor-view]')?.className).toContain(
        'pointer-events-none'
      )
      const canvas = floor.querySelector<HTMLCanvasElement>('canvas')!
      expect(canvas.style.clipPath, `floor ${i}`).toMatch(
        /^inset\(\d+px 0px \d+px\)|^inset\(\d+px 0px\)/
      )
      const top = Number(
        floor.querySelector<HTMLElement>('[data-scene-visible-top]')?.dataset.sceneVisibleTop
      )
      // The top floor's bubbles stay under its own visible top; lower ones may rise over the slab.
      expect(top, `floor ${i}`).toBe(
        i === 0 ? Number(/^inset\((\d+)px/.exec(canvas.style.clipPath)![1]) : 0
      )
    }
  })

  // Why the plate too: a bubble over a floor's name plate hid which floor it was (lead, 420 px).
  it('hands a floor the asker boxes of the floor above, so its rising bubbles keep off them', () => {
    vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(40)
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(18)
    const hosts = [local, remote('imac'), remote('m1')]
    const base = model(hosts)
    // The iMac member asks: its floor is in the middle, the lead's below it.
    base.members[1] = { ...base.members[1]!, needsYou: true }
    act(() => root.render(<TeamSceneBuilding model={base} makePainter={make} leadLine={null} />))
    const obstaclesOn = (key: string) =>
      Number(
        host
          .querySelector(`[data-team-floor="${key}"] [data-scene-obstacles]`)
          ?.getAttribute('data-scene-obstacles')
      )
    // Each floor's name plate, plus the iMac's asker box for the floor below it.
    expect(obstaclesOn('')).toBe(2)
    expect(obstaclesOn('m1')).toBe(1)
  })

  it("gives the lead's line to the floor where the lead stands, its own or the one it visits", () => {
    vi.useFakeTimers()
    const lines = () =>
      [...host.querySelectorAll<HTMLElement>('[data-team-floor]')]
        .filter((floor) => floor.querySelector('[data-scene-bubble="lead"]'))
        .map((floor) => floor.dataset.teamFloor)
    vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(60)
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(20)
    const asking = model([local, remote('imac')])
    asking.members[1] = { ...asking.members[1]!, needsYou: true }
    act(() => root.render(<TeamSceneBuilding model={asking} makePainter={make} leadLine="Busy" />))
    // Reduced motion: the ride shows its end, the lead by the member on the iMac floor.
    expect(lines()).toEqual(['imac'])
    act(() =>
      root.render(
        <TeamSceneBuilding
          model={model([local, remote('imac')])}
          makePainter={make}
          leadLine="Busy"
        />
      )
    )
    expect(lines()).toEqual([''])
    vi.useRealTimers()
  })

  describe('elevator and tube', () => {
    const asking = (hosts: TeamHost[], who: number): TeamSceneBuildingModel => {
      const base = model(hosts)
      return {
        ...base,
        members: base.members.map((m, i) => (i === who ? { ...m, needsYou: true } : m))
      }
    }
    const car = () => host.querySelector<HTMLElement>('[data-team-elevator-car]')
    const motion = (reduced: boolean) =>
      vi.spyOn(window, 'matchMedia').mockImplementation(
        (query) =>
          ({
            matches: reduced && query.includes('reduce'),
            media: query,
            addEventListener() {},
            removeEventListener() {}
          }) as unknown as MediaQueryList
      )

    const rider = () =>
      host.querySelector<HTMLElement>('[data-team-elevator-rider]')?.dataset.teamElevatorRider ??
      null

    it("keeps the car at the lead's floor until the lead boards, then carries it up, and back", () => {
      vi.useFakeTimers()
      motion(false)
      // Why no frames: happy-dom runs them on the wall clock, so a rider boarding by walking would
      // race the fake one; the board limit alone moves the car, the same on every run.
      vi.spyOn(window, 'requestAnimationFrame').mockReturnValue(1)
      render([local, remote('imac')])
      expect(car()?.dataset.teamElevatorCar).toBe('')
      const show = (next: TeamSceneBuildingModel): void =>
        act(() =>
          root.render(<TeamSceneBuilding model={next} makePainter={make} leadLine={null} />)
        )
      show(asking([local, remote('imac')], 1))
      // Walking out to the elevator: the car waits for it.
      expect(car()?.dataset.teamElevatorCar).toBe('')
      expect(rider()).toBeNull()
      // A scene that is not drawn never walks it there, so the car goes after its limit.
      act(() => vi.advanceTimersByTime(30_000))
      expect(car()?.dataset.teamElevatorCar).toBe('imac')
      expect(rider()).toBe('lead')
      act(() => vi.advanceTimersByTime(1_200))
      expect(rider()).toBeNull()
      show(model([local, remote('imac')]))
      expect(car()?.dataset.teamElevatorCar).toBe('imac')
      act(() => vi.advanceTimersByTime(30_000))
      expect(car()?.dataset.teamElevatorCar).toBe('')
      expect(rider()).toBe('lead')
      act(() => vi.advanceTimersByTime(1_200))
      expect(rider()).toBeNull()
      vi.useRealTimers()
    })

    it('brings the floor the car rides to into view, wherever the building is scrolled', () => {
      vi.useFakeTimers()
      motion(false)
      vi.spyOn(window, 'requestAnimationFrame').mockReturnValue(1)
      const seen: string[] = []
      vi.spyOn(HTMLElement.prototype, 'scrollIntoView').mockImplementation(
        function (this: HTMLElement) {
          seen.push(this.dataset.teamFloor ?? '?')
        }
      )
      const hosts = [local, remote('a'), remote('b'), remote('c'), remote('d')]
      render(hosts)
      seen.length = 0
      const asking = model(hosts)
      asking.members[4] = { ...asking.members[4]!, needsYou: true }
      act(() =>
        root.render(<TeamSceneBuilding model={asking} makePainter={make} leadLine={null} />)
      )
      act(() => vi.advanceTimersByTime(30_000))
      expect(car()?.dataset.teamElevatorCar).toBe('d')
      expect(seen).toContain('d')
      vi.useRealTimers()
    })

    // Why: a floor out of view draws no frames, so a lead there never walks to the door, and the
    // car waited its 30 s limit before leaving (building E2E, five floors, 2026-11-11).
    it('sends the car at once when the rider sets out from a floor out of view', () => {
      vi.useFakeTimers()
      motion(false)
      vi.spyOn(window, 'requestAnimationFrame').mockReturnValue(1)
      const watchers: { cb: IntersectionObserverCallback; els: Element[] }[] = []
      vi.stubGlobal(
        'IntersectionObserver',
        class {
          els: Element[] = []
          constructor(cb: IntersectionObserverCallback) {
            watchers.push({ cb, els: this.els })
          }
          observe(el: Element) {
            this.els.push(el)
          }
          unobserve() {}
          disconnect() {}
        }
      )
      const hosts = [local, remote('a'), remote('b'), remote('c'), remote('d')]
      render(hosts)
      // The lead's floor scrolls out of view.
      act(() => {
        for (const watcher of watchers) {
          const entries = watcher.els
            .filter((el) => (el as HTMLElement).dataset.teamFloor === '')
            .map(
              (el) =>
                ({ target: el, isIntersecting: false }) as unknown as IntersectionObserverEntry
            )
          if (entries.length > 0) {
            watcher.cb(entries, {} as IntersectionObserver)
          }
        }
      })
      const asking = model(hosts)
      asking.members[4] = { ...asking.members[4]!, needsYou: true }
      act(() =>
        root.render(<TeamSceneBuilding model={asking} makePainter={make} leadLine={null} />)
      )
      act(() => vi.advanceTimersByTime(1_200))
      expect(car()?.dataset.teamElevatorCar).toBe('d')
      vi.unstubAllGlobals()
      vi.useRealTimers()
    })

    it('shows where a ride ends at once under reduced motion', () => {
      motion(true)
      render([local, remote('imac')])
      act(() =>
        root.render(
          <TeamSceneBuilding
            model={asking([local, remote('imac')], 1)}
            makePainter={make}
            leadLine={null}
          />
        )
      )
      expect(car()?.dataset.teamElevatorCar).toBe('imac')
      expect(rider()).toBeNull()
    })

    it('sends a report up the tube when a member on another floor files one, never under reduced motion', () => {
      motion(false)
      render([local, remote('imac')])
      const filed = model([local, remote('imac')])
      filed.members[1] = { ...filed.members[1]!, summary: 'Report: #923 ready' }
      act(() => root.render(<TeamSceneBuilding model={filed} makePainter={make} leadLine={null} />))
      expect(
        host.querySelector('[data-team-tube-envelope]')?.getAttribute('data-team-tube-envelope')
      ).toBe('imac')
      // Why a new root: the reduced-motion preference is read when the scene mounts.
      act(() => root.unmount())
      root = createRoot(host)
      motion(true)
      render([local, remote('imac')])
      act(() => root.render(<TeamSceneBuilding model={filed} makePainter={make} leadLine={null} />))
      expect(host.querySelector('[data-team-tube-envelope]')).toBeNull()
    })

    it('takes the car to the floor of a member Jev just ruled on, and back once the advisor is done', () => {
      vi.useFakeTimers()
      motion(false)
      // Why no frames: happy-dom runs them on the wall clock, so a rider boarding by walking would
      // race the fake one; the board limit alone moves the car, the same on every run.
      vi.spyOn(window, 'requestAnimationFrame').mockReturnValue(1)
      const ruled = (ids: string[]): TeamSceneBuildingModel => {
        const base = model([local, remote('imac')])
        base.members[1] = {
          ...base.members[1]!,
          decisions: ids.map((id) => ({ id, verdict: 'allow', gesture: null }))
        }
        return base
      }
      const show = (next: TeamSceneBuildingModel): void =>
        act(() =>
          root.render(<TeamSceneBuilding model={next} makePainter={make} leadLine={null} />)
        )
      show(ruled(['d1']))
      expect(car()?.dataset.teamElevatorCar).toBe('')
      show(ruled(['d1', 'd2']))
      act(() => vi.advanceTimersByTime(30_000))
      expect(car()?.dataset.teamElevatorCar).toBe('imac')
      expect(rider()).toBe('advisor')
      // Why a second at a time: each stage's timer is set once React commits the one before.
      for (let second = 0; second < 90; second++) {
        act(() => vi.advanceTimersByTime(1_000))
      }
      expect(car()?.dataset.teamElevatorCar).toBe('')
      expect(rider()).toBeNull()
      vi.useRealTimers()
    })
  })
})
