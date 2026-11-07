// @vitest-environment happy-dom

import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { GameHostReading } from '../../../../shared/orchestrator-game-host-capacity'

const call = vi.hoisted(() => vi.fn())
vi.mock('@/runtime/runtime-rpc-client', () => ({ callRuntimeRpc: call }))

const { useTeamSoloMachineReadings } = await import('./use-team-solo-machine-readings')

const GB = 1024 ** 3
const host = { cpuCoreCount: 8, totalMemory: 16 * GB, availableMemory: 8 * GB, loadAverage1m: 1 }

type Seen = ReadonlyMap<string, GameHostReading> | null
let seen: Seen = null
let root: ReturnType<typeof createRoot> | null = null

function Probe({ ids, active }: { ids: string; active: boolean }): null {
  seen = useTeamSoloMachineReadings(ids, active)
  return null
}

async function mount(ids: string, active: boolean): Promise<void> {
  root = createRoot(document.createElement('div'))
  await act(async () => root?.render(<Probe ids={ids} active={active} />))
}

beforeEach(() => {
  vi.useFakeTimers()
  call.mockReset()
  call.mockResolvedValue({ host })
  seen = null
})
afterEach(async () => {
  await act(async () => root?.unmount())
  root = null
  vi.useRealTimers()
})

describe('useTeamSoloMachineReadings', () => {
  it('reads nothing while Machines is not on screen', async () => {
    await mount('env-1', false)

    expect(call).not.toHaveBeenCalled()
    expect(seen).toBeNull()
  })

  it('reads this machine and each saved host through the snapshot every host answers', async () => {
    await mount('env-1', true)

    expect(call).toHaveBeenCalledWith(
      { kind: 'local' },
      'diagnostics.memory',
      undefined,
      expect.anything()
    )
    expect(call).toHaveBeenCalledWith(
      { kind: 'environment', environmentId: 'env-1' },
      'diagnostics.memory',
      undefined,
      expect.anything()
    )
    const machine = { kind: 'ok', machine: host }
    expect(seen?.get('')).toEqual(machine)
    expect(seen?.get('env-1')).toEqual(machine)
  })

  it('reads a host that fails or answers nonsense as unreachable, keeping the others', async () => {
    call.mockImplementation(async (target: { kind: string; environmentId?: string }) => {
      if (target.environmentId === 'env-1') {
        throw new Error('offline')
      }
      return target.environmentId === 'env-2' ? { host: {} } : { host }
    })

    await mount('env-1\nenv-2', true)

    expect(seen?.get('env-1')).toEqual({ kind: 'unreachable' })
    expect(seen?.get('env-2')).toEqual({ kind: 'unreachable' })
    expect(seen?.get('')).toEqual({ kind: 'ok', machine: host })
  })

  it('reads again while it stays on screen and stops once it leaves', async () => {
    await mount('', true)
    expect(call).toHaveBeenCalledTimes(1)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(20_000)
    })
    expect(call).toHaveBeenCalledTimes(2)

    await act(async () => root?.unmount())
    root = null
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000)
    })
    expect(call).toHaveBeenCalledTimes(2)
  })

  it('drops a read that lands after the panel left', async () => {
    let answer: (value: unknown) => void = () => {}
    call.mockReturnValue(new Promise((resolve) => (answer = resolve)))
    await mount('', true)

    await act(async () => root?.render(<Probe ids="" active={false} />))
    await act(async () => answer({ host }))

    expect(seen).toBeNull()
  })
})
