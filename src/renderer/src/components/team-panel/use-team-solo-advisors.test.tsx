// @vitest-environment happy-dom

import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { GameMemberAdvisor } from '../../../../shared/orchestrator-game-member-advisor'
import { signalGameAdvisorChanged } from './game-advisor-signal'

const call = vi.hoisted(() => vi.fn())
vi.mock('@/runtime/runtime-rpc-client', () => ({ callRuntimeRpc: call }))

const { useTeamSoloAdvisors } = await import('./use-team-solo-advisors')

const advisor = { model: 'Sonnet 5.5', effort: 'low', pinned: { model: true, effort: false } }
const reads = JSON.stringify([
  { environmentId: null, paneKeys: ['tab-a:leaf'] },
  { environmentId: 'env-1', paneKeys: ['tab-b:leaf'] }
])

let seen: ReadonlyMap<string, GameMemberAdvisor> = new Map()
let root: ReturnType<typeof createRoot> | null = null
let localChanged: (() => void) | null = null

function Probe({ json, active }: { json: string; active: boolean }): null {
  seen = useTeamSoloAdvisors(json, active)
  return null
}

async function mount(json: string, active: boolean): Promise<void> {
  root = createRoot(document.createElement('div'))
  await act(async () => root?.render(<Probe json={json} active={active} />))
}

const answers = (paneKey: string) => ({ advisors: [{ paneKey, advisor }] })

beforeEach(() => {
  vi.useFakeTimers()
  call.mockReset()
  seen = new Map()
  localChanged = null
  Object.defineProperty(window, 'api', {
    configurable: true,
    value: {
      runtime: {
        onGameAdvisorChanged: (callback: () => void) => {
          localChanged = callback
          return () => {
            localChanged = null
          }
        }
      }
    }
  })
})
afterEach(async () => {
  await act(async () => root?.unmount())
  root = null
  vi.useRealTimers()
})

describe('useTeamSoloAdvisors', () => {
  it('reads nothing unless asked', async () => {
    await mount(reads, false)

    expect(call).not.toHaveBeenCalled()
    expect(seen.size).toBe(0)
  })

  it("asks each host for its own panes' reports", async () => {
    call.mockImplementation(async (target: { kind: string }) =>
      answers(target.kind === 'local' ? 'tab-a:leaf' : 'tab-b:leaf')
    )

    await mount(reads, true)

    expect(call).toHaveBeenCalledWith(
      { kind: 'local' },
      'game.paneAdvisors',
      { paneKeys: ['tab-a:leaf'] },
      expect.anything()
    )
    expect(call).toHaveBeenCalledWith(
      { kind: 'environment', environmentId: 'env-1' },
      'game.paneAdvisors',
      { paneKeys: ['tab-b:leaf'] },
      expect.anything()
    )
    expect(seen.get('tab-a:leaf')).toEqual(advisor)
    expect(seen.get('tab-b:leaf')).toEqual(advisor)
  })

  it('shows no section for a host older than the read, and keeps the others', async () => {
    call.mockImplementation(async (target: { kind: string }) => {
      if (target.kind === 'environment') {
        throw new Error('method_not_found')
      }
      return answers('tab-a:leaf')
    })

    await mount(reads, true)

    expect(seen.has('tab-b:leaf')).toBe(false)
    expect(seen.get('tab-a:leaf')).toEqual(advisor)
  })

  it('drops a report once its pane stops sending it, or its host stops answering', async () => {
    call.mockResolvedValue(answers('tab-a:leaf'))
    await mount(JSON.stringify([{ environmentId: null, paneKeys: ['tab-a:leaf'] }]), true)
    expect(seen.has('tab-a:leaf')).toBe(true)

    call.mockResolvedValue({ advisors: [] })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(20_000)
    })
    expect(seen.has('tab-a:leaf')).toBe(false)

    call.mockResolvedValue(answers('tab-a:leaf'))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(20_000)
    })
    expect(seen.has('tab-a:leaf')).toBe(true)

    call.mockRejectedValue(new Error('timeout'))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(20_000)
    })
    expect(seen.has('tab-a:leaf')).toBe(false)
  })

  // Why: a push alone reaches the Team panel at once; these rows must not lag it by a 20 s read.
  it('reads again when a Jev report changes on this computer or a paired host', async () => {
    call.mockResolvedValue({ advisors: [] })
    await mount(reads, true)
    expect(seen.size).toBe(0)

    call.mockResolvedValue(answers('tab-a:leaf'))
    await act(async () => localChanged?.())
    expect(seen.has('tab-a:leaf')).toBe(true)

    call.mockResolvedValue({ advisors: [] })
    await act(async () => signalGameAdvisorChanged())
    expect(seen.has('tab-a:leaf')).toBe(false)
  })

  it('keeps the newer answer when a slower read lands after it', async () => {
    let landSlow: (answer: unknown) => void = () => {}
    call.mockReturnValueOnce(new Promise((resolve) => (landSlow = resolve)))
    await mount(JSON.stringify([{ environmentId: null, paneKeys: ['tab-a:leaf'] }]), true)

    call.mockResolvedValueOnce(answers('tab-a:leaf'))
    await act(async () => signalGameAdvisorChanged())
    expect(seen.has('tab-a:leaf')).toBe(true)

    await act(async () => landSlow({ advisors: [] }))
    expect(seen.has('tab-a:leaf')).toBe(true)
  })

  it('stays with its timer on a build with no local push', async () => {
    Object.defineProperty(window, 'api', { configurable: true, value: { runtime: {} } })
    call.mockResolvedValue(answers('tab-a:leaf'))

    await mount(reads, true)

    expect(seen.has('tab-a:leaf')).toBe(true)
  })

  it('skips what a host of another build sends in a shape it cannot read', async () => {
    call.mockResolvedValue({
      advisors: [
        { paneKey: 'tab-a:leaf', advisor: 'jev' },
        { paneKey: 7, advisor },
        { paneKey: 'tab-b:leaf', advisor }
      ]
    })

    await mount(JSON.stringify([{ environmentId: null, paneKeys: ['tab-a:leaf'] }]), true)

    expect([...seen.keys()]).toEqual(['tab-b:leaf'])
  })

  it('stops reading when it leaves', async () => {
    call.mockResolvedValue({ advisors: [] })
    await mount(reads, true)
    expect(call).toHaveBeenCalledTimes(2)

    await act(async () => root?.unmount())
    root = null
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000)
      signalGameAdvisorChanged()
    })
    expect(localChanged).toBeNull()
    expect(call).toHaveBeenCalledTimes(2)
  })
})
