// Where the band overlay reads its inputs: the stored choice, main's probe and the viewport cells.
import type { IBufferCell, Terminal } from '@xterm/xterm'
import type { GameBand3dProbe } from '../../../../shared/game-band-3d-probe'
import { webglClassOf, type HardwareSignals } from './band-mode'
import type { BandCell } from './band-region'
import type { BandLib, BandScene } from './band-scene'

export type BandChoice = 'auto' | BandLib | 'cells'

export const BAND_CHOICE_KEY = 'orca.poc.band3d'
/** Dispatched on window after the stored choice changes, so live panes re-resolve. */
export const BAND_CHOICE_EVENT = 'orca:game-band-3d-choice'
export const BAND_TIER_KEY = 'orca.poc.band3d.tier'
export const CHOICES: readonly BandChoice[] = ['auto', 'three', 'ogl', 'pixi', 'cells']
/** The library auto uses; the report explains the pick. */
export const AUTO_LIB: BandLib = 'three'

export const readStorage = (key: string): string | null => {
  try {
    return window.localStorage.getItem(key)
  } catch {
    return null
  }
}

export const choiceOf = (): BandChoice => {
  const stored = readStorage(BAND_CHOICE_KEY)
  return CHOICES.find((one) => one === stored) ?? 'auto'
}

export const createScene = async (lib: BandLib): Promise<BandScene> => {
  switch (lib) {
    case 'three':
      return (await import('./band-scene-three')).createThreeBandScene()
    case 'ogl':
      return (await import('./band-scene-ogl')).createOglBandScene()
    case 'pixi':
      return (await import('./band-scene-pixi')).createPixiBandScene()
  }
}

export const probe = (): Promise<GameBand3dProbe | null> =>
  window.api?.app?.gameBand3dProbe?.().catch(() => null) ?? Promise.resolve(null)

export const rendererMbOf = (sample: GameBand3dProbe | null): { renderer: number; gpu: number } => {
  const processes = sample?.processes ?? []
  const renderer = processes.find((p) => p.pid === sample?.rendererPid)?.workingSetMb ?? 0
  const gpu = processes.find((p) => p.type === 'GPU')?.workingSetMb ?? 0
  return { renderer, gpu }
}

export const readViewport = (terminal: Terminal): ((y: number) => BandCell[] | null) => {
  const buffer = terminal.buffer.active
  let scratch: IBufferCell | undefined
  return (y) => {
    const line = buffer.getLine(buffer.viewportY + y)
    if (line === undefined) {
      return null
    }
    const cells: BandCell[] = []
    for (let x = 0; x < terminal.cols; x += 1) {
      scratch = line.getCell(x, scratch)
      cells.push({
        code: scratch?.getCode() ?? 32,
        isRgb: (scratch?.isFgRGB() || scratch?.isBgRGB()) ?? false
      })
    }
    return cells
  }
}

export const storeChoice = (choice: BandChoice): void => {
  try {
    window.localStorage.setItem(BAND_CHOICE_KEY, choice)
  } catch {
    /* the choice still applies to this pane */
  }
}

/** The renderer string is unknown until a scene exists; the overlay re-checks it then. */
export const hardwareSignalsOf = (
  sample: GameBand3dProbe | null
): { signals: HardwareSignals; webglFeatureStatus: string } => ({
  signals: {
    webgl: webglClassOf('unknown', sample?.webglFeatureStatus ?? 'enabled'),
    totalMemoryGb: sample?.totalMemoryGb ?? 8,
    cpuCores: sample?.cpuCores ?? navigator.hardwareConcurrency,
    prefersReducedMotion: window.matchMedia('(prefers-reduced-motion: reduce)').matches
  },
  webglFeatureStatus: sample?.webglFeatureStatus ?? 'unknown'
})
