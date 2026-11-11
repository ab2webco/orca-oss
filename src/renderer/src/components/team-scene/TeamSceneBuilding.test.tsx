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

    it("parks the car at the lead's floor, and at the floor of a member there who needs you", () => {
      render([local, remote('imac')])
      expect(car()?.dataset.teamElevatorCar).toBe('')
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
  })
})
