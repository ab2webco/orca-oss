/**
 * Orca's half of the statusline reset countdown: it turns `resets_at` into the relative duration
 * the script prints, and drops it in a per-account file the script reads with builtins.
 *
 * Why Orca does the arithmetic: the statusline runs several times a second and is pure shell
 * builtins over stdin by design. `resets_at` minus *now* needs a wall clock, and a POSIX shell
 * only gets one from `date` — a subprocess per tick, the exact cost this script exists to avoid.
 *
 * Why a file and not an environment variable injected at spawn: an env var freezes at that
 * instant, so a session left open for three hours would render a countdown three hours wrong. The
 * file is rewritten on every live usage post (at most one per pane per 15s), so a tick reads a
 * value that is at most one post old. A countdown lying by hours is worse than no countdown.
 *
 * Why keyed by account and not by pane: the reset is a property of the account's quota window, so
 * every pane signed into it reads the same value and refreshes it for the others.
 */

import { writeFileSync } from 'node:fs'
import { EOL, tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ClaudeStatusLineRateLimits } from '../../shared/claude-statusline-rate-limits'
import { formatResetDuration } from '../../shared/rate-limit-reset-format'
import { parseClaudeUsageResetTimestamp } from '../rate-limits/claude-usage-window'
import {
  STATUSLINE_RESET_DEFAULT_KEY,
  STATUSLINE_RESET_FILE_PREFIX,
  STATUSLINE_RESET_KEY_MAX_CHARS
} from './statusline-usage-gauge'

// Mirrors the script's own key: strip a trailing `auth` segment, take the leaf, and require a
// path-safe name. Anything else lands on the default file, which is where the script looks too.
const KEY_PATTERN = /^[A-Za-z0-9._-]+$/

function statuslineResetAccountKey(configDir: string | null): string {
  if (!configDir) {
    return STATUSLINE_RESET_DEFAULT_KEY
  }
  const segments = configDir.split(/[\\/]/).filter((segment) => segment.length > 0)
  const leaf = segments.at(-1) === 'auth' ? segments.at(-2) : segments.at(-1)
  if (!leaf || leaf.length > STATUSLINE_RESET_KEY_MAX_CHARS || !KEY_PATTERN.test(leaf)) {
    return STATUSLINE_RESET_DEFAULT_KEY
  }
  return leaf
}

/** Path the statusline script reads this account's countdown from. */
export function statuslineResetCountdownPath(configDir: string | null): string {
  const key = statuslineResetAccountKey(configDir)
  // Why the `.tmp` suffix only on Windows: the cmd variant names every per-pane file that way,
  // and the two scripts are the only readers.
  const suffix = process.platform === 'win32' ? '.tmp' : ''
  return join(tmpdir(), `${STATUSLINE_RESET_FILE_PREFIX}${key}${suffix}`)
}

/**
 * The countdown text, or empty when there is nothing honest to show.
 *
 * Why it reuses the roster's formatter: the same account must not read "2d 4h" in the app and
 * "2d3h" here. The space is dropped because the status line is budgeted in columns.
 */
export function formatStatuslineResetCountdown(msUntilReset: number): string {
  if (msUntilReset <= 0) {
    return ''
  }
  return formatResetDuration(msUntilReset).replace(' ', '')
}

/**
 * Refreshes the countdown file for the account that posted `event`.
 *
 * Writes an empty value when no reset is known, so a stale countdown is cleared the moment Orca
 * sees fresh data rather than surviving as a plausible-looking lie.
 */
export function publishStatuslineResetCountdown(
  event: ClaudeStatusLineRateLimits,
  now: number = Date.now()
): void {
  const resets = [event.fiveHour?.resets_at, event.sevenDay?.resets_at]
    .map((value) => parseClaudeUsageResetTimestamp(value))
    .filter((value): value is number => value !== null && value > now)
  // Why the soonest and not both: three durations do not fit the line, and the soonest is the
  // answer to "when do I get quota back" — the same one the usage roster's header summarises.
  const countdown =
    resets.length > 0 ? formatStatuslineResetCountdown(Math.min(...resets) - now) : ''
  try {
    writeFileSync(statuslineResetCountdownPath(event.configDir), `${countdown}${EOL}`)
  } catch {
    // Best-effort: an unwritable temp dir only costs this account the countdown field.
  }
}
