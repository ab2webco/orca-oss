// @vitest-environment happy-dom

import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useTeamSceneRideLegs } from './use-team-scene-ride-legs'

const T0 = 1_794_455_699_149
const WANTS = { lead: { floor: 'mbp', member: 'herrero' }, advisor: null }
// Why the lead's floor hidden: a rider setting out from a floor out of view boards at once.
const HIDDEN: ReadonlySet<string> = new Set(['local'])

function Harness(): React.JSX.Element {
  const { legs } = useTeamSceneRideLegs(WANTS, 'local', false, HIDDEN)
  return <span data-stage={legs.lead.stage} />
}

const roots: ReturnType<typeof createRoot>[] = []
afterEach(async () => {
  await act(async () => {
    for (const root of roots.splice(0)) {
      root.unmount()
    }
  })
  vi.useRealTimers()
  vi.restoreAllMocks()
})

async function ride(): Promise<{ stage: () => string | null; clock: (ms: number) => void }> {
  let now = T0
  vi.spyOn(Date, 'now').mockImplementation(() => now)
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  const host = document.createElement('div')
  const root = createRoot(host)
  roots.push(root)
  await act(async () => root.render(<Harness />))
  return {
    stage: () => host.querySelector('span')!.getAttribute('data-stage'),
    clock: (ms) => {
      now = T0 + ms
    }
  }
}

// Why (ORCA-1185): the queue's building spec stayed at 'travel' for 60 s.
describe('useTeamSceneRideLegs', () => {
  it('arrives even when the travel timer fires a millisecond early', async () => {
    const { stage, clock } = await ride()
    expect(stage()).toBe('travel')
    // The timer for the car's 1.2 s travel fires with the clock 1 ms short of it.
    clock(1_199)
    await act(async () => vi.advanceTimersByTime(1_200))
    expect(stage()).toBe('travel')
    clock(1_300)
    await act(async () => vi.advanceTimersByTime(1_000))
    expect(stage()).toBe('there')
  })

  it('arrives once the travel time has passed', async () => {
    const { stage, clock } = await ride()
    clock(1_300)
    await act(async () => vi.advanceTimersByTime(1_300))
    expect(stage()).toBe('there')
  })
})
