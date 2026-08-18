/**
 * The watchdog's log marker, shared by the process that writes it and the
 * classifier that reads it back.
 *
 * Why one place: a job killed by the watchdog exits non-zero, so the jobs API
 * calls it `failure` and it is otherwise indistinguishable from a red test
 * (ORCA-263). The log is the only surface carrying the difference, and a rename
 * on the writing side must not silently retire the detection.
 */

export const VITEST_HANG_ANNOTATION_TITLE = 'Vitest hang'
export const VITEST_HANG_BLOCK_HEADER = '===== orca hang watchdog ====='

/** `timeout(1)`'s convention, so the exit code alone separates the two too. */
export const VITEST_HANG_EXIT_CODE = 124

const MODULE_LINE = /^ {2}(\S+\.test\.[cm]?[jt]sx?) — (.+?), /m
const VERDICT_LINE = /^verdict: (\S+)/m
const SILENCE_LINE = /^silence: ([\d.]+)s/m
const EXIT_CODE_LINE = new RegExp(`Process completed with exit code ${VITEST_HANG_EXIT_CODE}\\.`)

/**
 * @typedef {object} VitestHangDetection
 * @property {boolean} hang
 * @property {string|null} verdict
 * @property {string|null} module wedged test file, when the block named one
 * @property {string|null} phase how the module was stuck, as the block printed it
 * @property {number|null} silenceSeconds
 * @property {boolean} exitCodeSeen
 */

/**
 * @param {string|null|undefined} logText raw job log; GitHub's timestamp prefix is tolerated
 * @returns {VitestHangDetection}
 */
export function detectVitestHangInLog(logText) {
  const absent = {
    hang: false,
    verdict: null,
    module: null,
    phase: null,
    silenceSeconds: null,
    exitCodeSeen: false
  }
  if (!logText) {
    return absent
  }
  // Why not the exit code alone: any step may exit 124 for its own reasons, so
  // the watchdog's own marker is what identifies the class.
  const marked =
    logText.includes(VITEST_HANG_BLOCK_HEADER) ||
    logText.includes(`::error title=${VITEST_HANG_ANNOTATION_TITLE}::`)
  if (!marked) {
    return absent
  }
  // GitHub prefixes every log line with a timestamp; strip it before matching
  // the block's column-anchored lines.
  const stripped = logText.replace(/^\S+Z /gm, '')
  const moduleMatch = MODULE_LINE.exec(stripped)
  // The block prints absolute paths; a repo-relative one is what a reader can grep.
  const module = moduleMatch?.[1].replace(/^.*?(?=(?:src|tests|config)\/)/, '') ?? null
  const silence = SILENCE_LINE.exec(stripped)
  return {
    hang: true,
    verdict: VERDICT_LINE.exec(stripped)?.[1] ?? null,
    module,
    phase: moduleMatch?.[2] ?? null,
    silenceSeconds: silence ? Number(silence[1]) : null,
    exitCodeSeen: EXIT_CODE_LINE.test(stripped)
  }
}
