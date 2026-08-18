// Why a signal and not a timer: the watchdog asks only once, at the moment it has
// already decided the run is wedged, so a polling probe would be pure overhead.
// Loaded only when ORCA_VITEST_HANG_JOURNAL is set (see config/vitest.config.ts).
import { expect } from 'vitest'

const PROBE_INSTALLED = Symbol.for('orca.vitestWorkerActiveResourcesProbe')

type ProbeState = { lastModule: string | null }

const globals = globalThis as unknown as Record<symbol, ProbeState | undefined>

function installProbe(): ProbeState {
  const existing = globals[PROBE_INSTALLED]
  if (existing) {
    return existing
  }
  const state: ProbeState = { lastModule: null }
  globals[PROBE_INSTALLED] = state
  // Node does not ref signal handles, so this cannot itself hold the worker open.
  process.on('SIGUSR2', () => {
    const resources = process.getActiveResourcesInfo?.() ?? []
    process.stdout.write(
      `[orca-hang-watchdog] worker pid=${process.pid} module=${state.lastModule ?? 'unknown'} activeResources=${JSON.stringify(resources)}\n`
    )
  })
  return state
}

installProbe().lastModule = expect.getState().testPath ?? null
