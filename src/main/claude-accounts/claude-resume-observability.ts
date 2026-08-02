import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  createManagedCommandMatcher,
  isPlainObject,
  type HookDefinition
} from '../agent-hooks/installer-utils'
import { getManagedScriptFileName } from '../claude/hook-settings'

/**
 * ORCA-168: every managed hook except SessionStart needs a turn to happen first,
 * so a Claude that resumed and is waiting for input reports nothing. A universe
 * without the managed SessionStart hook can never prove which session came back,
 * which makes both the switch's verification and its rollback's re-verification
 * dead ends.
 */
export function settingsReportResumedClaudeSession(
  settingsJson: string | null,
  scriptFileName = getManagedScriptFileName()
): boolean {
  if (!settingsJson) {
    return false
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(settingsJson)
  } catch {
    return false
  }
  if (!isPlainObject(parsed)) {
    return false
  }
  const hooks = (parsed as { hooks?: unknown }).hooks
  if (!isPlainObject(hooks)) {
    return false
  }
  const definitions = (hooks as Record<string, unknown>).SessionStart
  if (!Array.isArray(definitions)) {
    return false
  }
  const isManagedCommand = createManagedCommandMatcher(scriptFileName)
  return (definitions as HookDefinition[]).some((definition) => {
    if (!isPlainObject(definition)) {
      return false
    }
    if (isManagedCommand(definition.command)) {
      return true
    }
    return Array.isArray(definition.hooks)
      ? definition.hooks.some((hook) => isManagedCommand(hook?.command))
      : false
  })
}

/** Reads the universe's own settings.json; a missing or unreadable file is a no. */
export function claudeUniverseReportsResumedSession(configDir: string): boolean {
  try {
    return settingsReportResumedClaudeSession(
      readFileSync(join(configDir, 'settings.json'), 'utf8')
    )
  } catch {
    return false
  }
}
