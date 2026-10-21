import { startSpan } from '../../observability/tracer'
import type { OrcaRuntimeService } from '../orca-runtime'

type OrchestrationLaunchRuntime = Pick<
  OrcaRuntimeService,
  'prepareLegacyWorkerTerminalRecovery' | 'ensureOrchestrationDispatchDeadlineMonitor'
>

// Why (ORCA-726): this runs inside app.whenReady() before the window opens; a throw from opening
// orchestration.db left the app running with no window on every launch.
export function startOrchestrationAtLaunch(runtime: OrchestrationLaunchRuntime): void {
  try {
    runtime.prepareLegacyWorkerTerminalRecovery()
    // Why (ORCA-191): armed deadlines live in the DB, so a restart re-arms the scan here.
    runtime.ensureOrchestrationDispatchDeadlineMonitor()
  } catch (error) {
    console.error('[orchestration] startup failed; the app continues without it', error)
    startSpan('orchestration.startup').fail(
      error instanceof Error ? error : new Error(String(error))
    )
  }
}
