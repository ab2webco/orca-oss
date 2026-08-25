// Test-process logging and headful selection, lifted out of orca-app.ts to keep
// that fixture file under its 300-line cap (ORCA-300). Both answer "how is this
// spec run and observed", not "what does the fixture provide".
import type { ElectronApplication, TestInfo } from '@stablyai/playwright-test'

export function shouldLaunchHeadful(testInfo: TestInfo): boolean {
  // Why: ORCA_E2E_FORCE_HEADFUL lets a developer watch any spec in a real
  // window without retagging it `@headful` or switching projects.
  if (process.env.ORCA_E2E_FORCE_HEADFUL === '1') {
    return true
  }
  return testInfo.project.metadata.orcaHeadful === true
}

// Why: exported so specs that launch their own ElectronApplication outside
// this fixture (e.g. multi-instance lifecycle tests) can still opt into the
// same ORCA_E2E_FORWARD_APP_LOGS-gated stdout/stderr capture.
export function forwardElectronProcessLogs(app: ElectronApplication, testInfo: TestInfo): void {
  if (process.env.ORCA_E2E_FORWARD_APP_LOGS !== '1') {
    return
  }

  const child = app.process()
  const prefix = `[electron:${testInfo.title}]`
  child.stdout?.on('data', (chunk: Buffer) => {
    console.log(`${prefix} stdout: ${chunk.toString().trimEnd()}`)
  })
  child.stderr?.on('data', (chunk: Buffer) => {
    console.error(`${prefix} stderr: ${chunk.toString().trimEnd()}`)
  })
  child.on('exit', (code, signal) => {
    console.log(`${prefix} exit: code=${code ?? 'null'} signal=${signal ?? 'null'}`)
  })
}
