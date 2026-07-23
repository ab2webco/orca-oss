import { execFileSync } from 'node:child_process'
import { compareAppVersions } from '../../shared/app-version'
import { resolveClaudeCommand } from '../codex-cli/command'
import { CLAUDE_EVENTS, type ClaudeHookEventSpec } from './hook-settings'

// Why: Claude Code < 2.1.101 rejects the whole settings.json on an unknown hook
// key (2.1.101 added tolerance and ignores them). When the client version is
// unknown, inject only events present on long-stable clients (minVersion <=
// this floor): UserPromptSubmit, Stop, PreToolUse, PostToolUse, SubagentStop.
// An undetectable version is exactly the unknown-old client that breaks.
export const UNKNOWN_VERSION_EVENT_FLOOR = '1.0.54'

// `claude --version` prints a bare semver, e.g. "2.1.218 (Claude Code)".
const CLAUDE_VERSION_PATTERN = /(\d+\.\d+\.\d+)/

export function parseClaudeCodeVersion(output: string): string | null {
  return output.match(CLAUDE_VERSION_PATTERN)?.[1] ?? null
}

// Why: probe the installed Claude Code version so gating matches the client that
// will read settings.json. Returns null on any failure (binary missing, spawn
// error, unparseable output) so callers fall back to the safe base set.
export function detectClaudeCodeVersion(
  resolveCommand: () => string = resolveClaudeCommand
): string | null {
  try {
    const output = execFileSync(resolveCommand(), ['--version'], {
      encoding: 'utf-8',
      timeout: 5000,
      stdio: ['ignore', 'pipe', 'ignore']
    })
    return parseClaudeCodeVersion(output)
  } catch {
    return null
  }
}

// Why: keep only events the detected client recognizes; an unknown version drops
// to the always-safe base set (see UNKNOWN_VERSION_EVENT_FLOOR). install() and
// getStatus() share this so an older client doesn't perpetually report "partial".
export function selectClaudeEventsForVersion(
  detectedVersion: string | null,
  events: readonly ClaudeHookEventSpec[] = CLAUDE_EVENTS
): readonly ClaudeHookEventSpec[] {
  const ceiling = detectedVersion ?? UNKNOWN_VERSION_EVENT_FLOOR
  return events.filter((event) => compareAppVersions(event.minVersion, ceiling) <= 0)
}

export type EventGatingOptions = {
  versionGated: boolean
  detectVersion: () => string | null
}

// Why: local install gates on the detected version; an ungated agent (OpenClaude,
// independent versioning) keeps the full set.
export function resolveLocalEligibleEvents(
  options: EventGatingOptions
): readonly ClaudeHookEventSpec[] {
  return options.versionGated
    ? selectClaudeEventsForVersion(options.detectVersion())
    : CLAUDE_EVENTS
}

// Why: the remote box's version is unknown and unprobed, so gate conservatively
// to the always-safe base set; ungated agents keep the full set.
export function resolveRemoteEligibleEvents(versionGated: boolean): readonly ClaudeHookEventSpec[] {
  return versionGated ? selectClaudeEventsForVersion(null) : CLAUDE_EVENTS
}
