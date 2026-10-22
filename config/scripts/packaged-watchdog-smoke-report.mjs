// Messages for smoke-packaged-hang-watchdog-worker.mjs. Two ETIMEDOUT failures on
// 2026-10-22 (ORCA-751) printed no duration and no output, so nothing said whether
// Electron started slowly or the worker stalled.

const PREFIX = '[packaged-watchdog-smoke]'
const PHASE_LINE = /^\[packaged-watchdog-smoke\] phase=(\S+ t=\d+ms)$/

export function smokePhaseLine(phase, uptimeMs) {
  return `${PREFIX} phase=${phase} t=${Math.round(uptimeMs)}ms`
}

export function lastSmokePhase(stdout) {
  const phases = stdout
    .split('\n')
    .map((line) => PHASE_LINE.exec(line.trim())?.[1])
    .filter((phase) => phase !== undefined)
  return phases.at(-1) ?? null
}

export function formatSmokeSuccess({ elapsedMs, budgetMs }) {
  return `${PREFIX} electron exited after ${Math.round(elapsedMs)} ms of a ${budgetMs} ms budget`
}

// Why result.error first: spawnSync's timeout sends SIGTERM, Electron quits gracefully
// with status 0, and only result.error still says ETIMEDOUT.
export function smokeSucceeded(result, successLine) {
  return !result.error && result.status === 0 && (result.stdout ?? '').includes(successLine)
}

function describeCause(result) {
  if (result.error) {
    return result.error.message
  }
  if (result.signal) {
    return result.signal
  }
  return result.status === 0 ? 'exit 0 without the success line' : `exit ${result.status}`
}

export function formatSmokeFailure({ result, elapsedMs, budgetMs }) {
  const cause = describeCause(result)
  const stdout = result.stdout ?? ''
  const stderr = result.stderr ?? ''
  return [
    `Packaged watchdog smoke failed (${cause}) after ${Math.round(elapsedMs)} ms of a ${budgetMs} ms budget; ` +
      `last phase: ${lastSmokePhase(stdout) ?? 'none'}`,
    `--- stdout ---\n${stdout}`,
    `--- stderr ---\n${stderr}`
  ].join('\n')
}
