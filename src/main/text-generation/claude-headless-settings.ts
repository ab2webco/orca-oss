import { app } from 'electron'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

let writtenSettingsPath: string | null = null

/**
 * Settings file for one-shot Claude generation. Why: a file, not inline JSON,
 * because a Windows .cmd shim rejects `"` in argv; written once per process.
 */
export function getClaudeHeadlessSettingsPath(): string {
  if (writtenSettingsPath) {
    return writtenSettingsPath
  }
  const dir = join(app.getPath('userData'), 'text-generation')
  const settingsPath = join(dir, 'claude-headless-settings.json')
  mkdirSync(dir, { recursive: true })
  // Why: project SessionStart hooks run before the prompt is answered and took 20-80s here.
  writeFileSync(settingsPath, `${JSON.stringify({ disableAllHooks: true })}\n`)
  writtenSettingsPath = settingsPath
  return settingsPath
}
