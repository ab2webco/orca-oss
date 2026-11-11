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

  it('shows at most three floors and the rest as a count, while a button reaches each one', () => {
    render([local, remote('a'), remote('b'), remote('c')])
    expect(floors()).toHaveLength(3)
    expect(host.textContent).toContain('+1')
    for (const name of ['local', 'a', 'b', 'c']) {
      expect(button(name)).toBeTruthy()
    }
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
    expect(plates).toEqual(['m1', 'imac', 'local'])
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
