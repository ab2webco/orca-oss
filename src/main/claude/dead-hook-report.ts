import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { Notification } from 'electron'
import { getClaudeManagedAccountsRoot } from '../claude-accounts/managed-auth-path'
import { translateMain } from '../i18n/main-i18n'
import { findDeadHookScripts, type DeadHookScript } from './dead-hook-scripts'
import { getConfigPath } from './hook-settings'

// Why a rescan: the script usually disappears while Orca runs (a dev profile or a plugin
// version deleted), and Claude then prints a Node stack on every tool call.
const RESCAN_INTERVAL_MS = 10 * 60_000
// Why a delay: plugin workers rewrite their hooks on activation; a scan before that would
// report paths an update is about to replace.
const FIRST_SCAN_DELAY_MS = 2 * 60_000
const NAMED_IN_NOTICE = 3

type DeadHookReportDeps = {
  readFile: (path: string) => string | null
  exists: (path: string) => boolean
}

/** ~/.claude plus every vault Orca keeps under `<accountsRoot>/<id>/auth`. */
export function listClaudeSettingsPaths(homeSettingsPath: string, accountsRoot: string): string[] {
  let accountIds: string[] = []
  try {
    accountIds = readdirSync(accountsRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
  } catch {
    // No accounts yet.
  }
  return [
    homeSettingsPath,
    ...accountIds.map((id) => join(accountsRoot, id, 'auth', 'settings.json'))
  ]
}

/** Dead hooks not reported yet; `reported` keeps each one to a single notice per session. */
export function collectNewDeadHookScripts(
  settingsPaths: readonly string[],
  deps: DeadHookReportDeps,
  reported: Set<string>
): DeadHookScript[] {
  const fresh: DeadHookScript[] = []
  for (const settingsPath of settingsPaths) {
    const raw = deps.readFile(settingsPath)
    if (raw === null) {
      continue
    }
    let settings: unknown
    try {
      settings = JSON.parse(raw)
    } catch {
      continue
    }
    for (const dead of findDeadHookScripts(settingsPath, settings, deps.exists)) {
      const key = `${dead.settingsPath}\0${dead.event}\0${dead.scriptPath}`
      if (!reported.has(key)) {
        reported.add(key)
        fresh.push(dead)
      }
    }
  }
  return fresh
}

function label(dead: DeadHookScript): string {
  return dead.plugin ? `${dead.name} (${dead.plugin})` : dead.name
}

export function formatDeadHookNotice(dead: readonly DeadHookScript[]): {
  title: string
  body: string
} {
  const names = [...new Set(dead.map(label))]
  const scripts = [...new Set(dead.map((entry) => entry.scriptPath))]
  const title = translateMain('claudeDeadHooks.title', 'Claude hooks are not running')
  if (names.length === 1 && scripts.length === 1) {
    return {
      title,
      body: translateMain(
        'claudeDeadHooks.one',
        '{{name}} is not running: its script {{script}} is missing. Reinstall it or remove the hook from settings.json.',
        { name: names[0], script: scripts[0] }
      )
    }
  }
  const shown = names.slice(0, NAMED_IN_NOTICE).join('; ')
  const more = names.length - NAMED_IN_NOTICE
  return {
    title,
    body:
      more > 0
        ? translateMain(
            'claudeDeadHooks.manyMore',
            '{{count}} hooks are not running because their scripts are missing: {{names}} and {{more}} more. See the Orca Lab log for each path.',
            { count: names.length, names: shown, more }
          )
        : translateMain(
            'claudeDeadHooks.many',
            '{{count}} hooks are not running because their scripts are missing: {{names}}. See the Orca Lab log for each path.',
            { count: names.length, names: shown }
          )
  }
}

function readFileOrNull(path: string): string | null {
  try {
    return readFileSync(path, 'utf-8')
  } catch {
    return null
  }
}

function reportDeadHooks(reported: Set<string>): void {
  const settingsPaths = listClaudeSettingsPaths(getConfigPath(), getClaudeManagedAccountsRoot())
  const fresh = collectNewDeadHookScripts(
    settingsPaths,
    { readFile: readFileOrNull, exists: existsSync },
    reported
  )
  if (fresh.length === 0) {
    return
  }
  for (const dead of fresh) {
    console.warn(
      `[claude-hooks] ${label(dead)} is not running: ${dead.event} hook script ${dead.scriptPath} is missing (${dead.settingsPath})`
    )
  }
  try {
    if (Notification.isSupported()) {
      new Notification(formatDeadHookNotice(fresh)).show()
    }
  } catch {
    // Best-effort: the log line above already names every hook.
  }
}

export function startDeadClaudeHookReporter(): () => void {
  const reported = new Set<string>()
  let interval: ReturnType<typeof setInterval> | null = null
  const first = setTimeout(() => {
    reportDeadHooks(reported)
    interval = setInterval(() => reportDeadHooks(reported), RESCAN_INTERVAL_MS)
    interval.unref?.()
  }, FIRST_SCAN_DELAY_MS)
  first.unref?.()
  return () => {
    clearTimeout(first)
    if (interval) {
      clearInterval(interval)
    }
  }
}
