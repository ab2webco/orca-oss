import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  classifyUnresponsiveRenderer,
  evaluateWithinRendererBudget,
  type RendererWindowEvidence
} from './unresponsive-renderer-evidence'

afterEach(() => {
  vi.useRealTimers()
})

function rendererWindow(overrides: Partial<RendererWindowEvidence> = {}): RendererWindowEvidence {
  return {
    url: 'file:///out/renderer/index.html',
    crashed: false,
    loading: false,
    pid: 4242,
    cpuCorePercent: 3,
    workingSetKb: 300_000,
    ...overrides
  }
}

describe('classifyUnresponsiveRenderer', () => {
  it('blames the main process when it cannot answer either', () => {
    expect(classifyUnresponsiveRenderer({ mainResponsive: false })).toBe('main-unresponsive')
  })

  it('reports a crashed renderer before anything else', () => {
    expect(
      classifyUnresponsiveRenderer({
        mainResponsive: true,
        windows: [rendererWindow({ crashed: true, loading: true, cpuCorePercent: 100 })]
      })
    ).toBe('renderer-crashed')
  })

  it('reports a reload in flight', () => {
    expect(
      classifyUnresponsiveRenderer({
        mainResponsive: true,
        windows: [rendererWindow({ loading: true })]
      })
    ).toBe('renderer-loading')
  })

  it('tells a pinned main thread from one that is waiting', () => {
    expect(
      classifyUnresponsiveRenderer({
        mainResponsive: true,
        windows: [rendererWindow({ cpuCorePercent: 99 })]
      })
    ).toBe('renderer-busy')
    expect(
      classifyUnresponsiveRenderer({ mainResponsive: true, windows: [rendererWindow()] })
    ).toBe('renderer-waiting')
  })

  it('reports a client that lost its window', () => {
    expect(classifyUnresponsiveRenderer({ mainResponsive: true, windows: [] })).toBe('no-window')
  })
})

describe('evaluateWithinRendererBudget', () => {
  it('returns the evaluate result without collecting evidence', async () => {
    const collect = vi.fn()

    await expect(
      evaluateWithinRendererBudget(async () => 7, collect, { label: 'mirror', budgetMs: 1_000 })
    ).resolves.toBe(7)
    expect(collect).not.toHaveBeenCalled()
  })

  it('names the stalled renderer instead of hanging the poll', async () => {
    vi.useFakeTimers()
    const collect = vi.fn(async () => ({
      mainResponsive: true as const,
      windows: [rendererWindow({ cpuCorePercent: 98.6 })]
    }))
    const run = evaluateWithinRendererBudget(() => new Promise<never>(() => {}), collect, {
      label: 'Client never mirrored host tab web-terminal-1',
      budgetMs: 15_000
    })
    const assertion = expect(run).rejects.toThrow(
      /Client never mirrored host tab web-terminal-1: renderer did not answer page\.evaluate within 15000ms \(renderer-busy\); pid=4242 cpu=99%ofCore workingSet=293MB crashed=false loading=false/
    )

    await vi.advanceTimersByTimeAsync(15_000)
    await assertion
    expect(collect).toHaveBeenCalledTimes(1)
  })

  it('lets a thrown evaluate surface unchanged', async () => {
    await expect(
      evaluateWithinRendererBudget(() => Promise.reject(new Error('Target crashed')), vi.fn(), {
        label: 'mirror',
        budgetMs: 1_000
      })
    ).rejects.toThrow('Target crashed')
  })
})
