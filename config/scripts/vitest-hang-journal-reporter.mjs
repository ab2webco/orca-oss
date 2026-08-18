/**
 * Vitest reporter that records the module lifecycle to the hang journal.
 *
 * Why it can see what the worker cannot report: this runs in vitest's main
 * process, so a worker wedged synchronously stops emitting events but never
 * stops this from having already written the module's queue and start.
 */

import { appendHangJournalEvent, HANG_JOURNAL_ENV } from './vitest-hang-journal.mjs'

export default class VitestHangJournalReporter {
  #path = process.env[HANG_JOURNAL_ENV] ?? null

  constructor() {
    if (!this.#path) {
      return
    }
    // Answers the watchdog's one question about this process; workers answer the
    // same signal from config/scripts/vitest-worker-active-resources-probe.ts.
    process.on('SIGUSR2', () => {
      const resources = process.getActiveResourcesInfo?.() ?? []
      process.stdout.write(
        `[orca-hang-watchdog] vitest main pid=${process.pid} activeResources=${JSON.stringify(resources)}\n`
      )
    })
  }

  #write(event) {
    if (!this.#path) {
      return
    }
    try {
      appendHangJournalEvent(this.#path, { atMs: Date.now(), ...event })
    } catch {
      // Never let bookkeeping fail a run it only observes.
    }
  }

  onTestRunStart(specifications) {
    this.#write({
      event: 'run-start',
      pid: process.pid,
      modules: specifications.map((specification) => specification.moduleId)
    })
  }

  onTestModuleQueued(testModule) {
    this.#write({ event: 'module-queued', module: testModule.moduleId })
  }

  onTestModuleStart(testModule) {
    this.#write({ event: 'module-start', module: testModule.moduleId })
  }

  onTestModuleEnd(testModule) {
    this.#write({ event: 'module-end', module: testModule.moduleId })
  }

  onTestRunEnd(_testModules, _unhandledErrors, reason) {
    this.#write({ event: 'run-end', reason })
  }
}
