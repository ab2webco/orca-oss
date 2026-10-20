import { describe, expect, it } from 'vitest'
import {
  BAND_BUDGETS,
  initialBandModeOf,
  nextBandModeOf,
  webglClassOf,
  type BandWindow,
  type HardwareSignals
} from './band-mode'

const signals = (overrides: Partial<HardwareSignals> = {}): HardwareSignals => ({
  webgl: 'hardware',
  totalMemoryGb: 32,
  cpuCores: 10,
  prefersReducedMotion: false,
  ...overrides
})

const healthy: BandWindow = { fps: 60, frameP95Ms: 17, rendererGrowthMb: 20 }

describe('webglClassOf', () => {
  it('reads SwiftShader, llvmpipe and Microsoft Basic Render as software', () => {
    for (const renderer of [
      'ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero)), SwiftShader driver)',
      'llvmpipe (LLVM 15.0.7, 256 bits)',
      'ANGLE (Microsoft, Microsoft Basic Render Driver Direct3D11)'
    ]) {
      expect(webglClassOf(renderer, 'enabled')).toBe('software')
    }
  })

  it('reads a real GPU as hardware', () => {
    expect(
      webglClassOf(
        'ANGLE (Apple, ANGLE Metal Renderer: Apple M2 Pro, Unspecified Version)',
        'enabled'
      )
    ).toBe('hardware')
  })

  it('reads a disabled feature status or no context as none', () => {
    expect(webglClassOf(null, 'enabled')).toBe('none')
    expect(webglClassOf('Apple M2', 'unavailable_off')).toBe('none')
    expect(webglClassOf('Apple M2', 'disabled_off')).toBe('none')
  })

  it('reads a software feature status as software even with a GPU-looking string', () => {
    expect(webglClassOf('Apple M2', 'unavailable_software')).toBe('software')
  })
})

describe('initialBandModeOf', () => {
  it('runs the full 3D band on a hardware GPU with 16 GB and 8 cores or more', () => {
    expect(initialBandModeOf(signals())).toBe('3d-full')
  })

  it('runs the lite 3D band on an 8 GB class machine', () => {
    expect(initialBandModeOf(signals({ totalMemoryGb: 8, cpuCores: 4 }))).toBe('3d-lite')
  })

  it('keeps the 2D cells under software rendering, no WebGL or under 8 GB', () => {
    expect(initialBandModeOf(signals({ webgl: 'software' }))).toBe('cells')
    expect(initialBandModeOf(signals({ webgl: 'none' }))).toBe('cells')
    expect(initialBandModeOf(signals({ totalMemoryGb: 4 }))).toBe('cells')
  })

  it('goes flat when the user asked for reduced motion', () => {
    expect(initialBandModeOf(signals({ prefersReducedMotion: true }))).toBe('flat')
  })
})

describe('nextBandModeOf', () => {
  it('keeps the mode while every window is inside the budget', () => {
    expect(nextBandModeOf('3d-full', [healthy, healthy, healthy])).toBe('3d-full')
  })

  it('drops one level after the configured number of slow windows in a row', () => {
    const slow: BandWindow = { ...healthy, fps: 40, frameP95Ms: 30 }
    const windows = Array.from({ length: BAND_BUDGETS.breachWindows }, () => slow)
    expect(nextBandModeOf('3d-full', windows)).toBe('3d-lite')
    expect(
      nextBandModeOf(
        '3d-lite',
        windows.map(() => ({ ...slow, fps: 20, frameP95Ms: 60 }))
      )
    ).toBe('cells')
  })

  it('ignores one slow window between healthy ones', () => {
    const slow: BandWindow = { ...healthy, fps: 40, frameP95Ms: 30 }
    expect(nextBandModeOf('3d-full', [slow, healthy, slow])).toBe('3d-full')
  })

  it('leaves WebGL at once when renderer memory crosses the budget', () => {
    const heavy: BandWindow = { ...healthy, rendererGrowthMb: BAND_BUDGETS.rendererGrowthMb + 1 }
    expect(nextBandModeOf('3d-full', [heavy])).toBe('cells')
  })

  it('never upgrades on its own and never moves the 2D or flat modes', () => {
    expect(nextBandModeOf('3d-lite', [healthy, healthy, healthy])).toBe('3d-lite')
    const slow: BandWindow = { fps: 5, frameP95Ms: 300, rendererGrowthMb: 5000 }
    expect(nextBandModeOf('cells', [slow, slow, slow])).toBe('cells')
    expect(nextBandModeOf('flat', [slow, slow, slow])).toBe('flat')
  })
})
