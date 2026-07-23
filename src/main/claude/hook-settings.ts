import { homedir } from 'node:os'
import { join } from 'node:path'
import {
  buildManagedCommandHook,
  createManagedCommandMatcher,
  getSharedManagedScriptPath,
  isPlainObject,
  removeManagedCommands,
  wrapPosixHookCommand,
  wrapWindowsGitBashHookCommand,
  type HookDefinition,
  type HooksConfig
} from '../agent-hooks/installer-utils'

export type ClaudeCompatibleHookSettings = {
  configDirName: '.claude' | '.openclaude'
  scriptBaseName: 'claude-hook' | 'openclaude-hook'
}

export const CLAUDE_HOOK_SETTINGS: ClaudeCompatibleHookSettings = {
  configDirName: '.claude',
  scriptBaseName: 'claude-hook'
}

export const OPENCLAUDE_HOOK_SETTINGS: ClaudeCompatibleHookSettings = {
  configDirName: '.openclaude',
  scriptBaseName: 'openclaude-hook'
}

export type ClaudeHookEventSpec = {
  eventName: string
  // Minimum Claude Code version that recognizes this hook event. Claude Code
  // < 2.1.101 validates the hooks object against a strict enum and rejects the
  // ENTIRE settings.json on an unknown key, so injecting a newer event wipes the
  // user's theme/permissions/MCP config. Callers gate injection on this floor;
  // see hook-event-versions.ts. Versions taken from the Claude Code CHANGELOG.
  minVersion: string
  definition: HookDefinition
}

// Why: version-gated at install time (hook-event-versions.ts) — the 1.0.x base
// events are effectively always-on, but the minVersion is annotated for every
// entry so the floor for each key is self-documenting.
export const CLAUDE_EVENTS: readonly ClaudeHookEventSpec[] = [
  {
    eventName: 'UserPromptSubmit',
    minVersion: '1.0.54',
    definition: { hooks: [{ type: 'command', command: '' }] }
  },
  {
    eventName: 'Stop',
    minVersion: '1.0.38',
    definition: { hooks: [{ type: 'command', command: '' }] }
  },
  // Why: OpenClaude skips normal Stop hooks after API/model errors and emits
  // StopFailure instead; without this hook Orca leaves the turn spinning.
  {
    eventName: 'StopFailure',
    minVersion: '2.1.78',
    definition: { hooks: [{ type: 'command', command: '' }] }
  },
  // Why: subagent/teammate lifecycle feeds the sidebar's child rows and keeps
  // a pane 'working' while background children outlive the lead's turn.
  // TeammateIdle parks turn-based teammates without trusting their permanently
  // "running" background_tasks entry to gate the pane.
  {
    eventName: 'SubagentStart',
    minVersion: '2.0.43',
    definition: { hooks: [{ type: 'command', command: '' }] }
  },
  {
    eventName: 'SubagentStop',
    minVersion: '1.0.41',
    definition: { hooks: [{ type: 'command', command: '' }] }
  },
  {
    eventName: 'TeammateIdle',
    minVersion: '2.1.33',
    definition: { hooks: [{ type: 'command', command: '' }] }
  },
  // Why: PreToolUse gives the dashboard a live readout of the in-flight tool
  // (name + input preview) before it completes.
  {
    eventName: 'PreToolUse',
    minVersion: '1.0.38',
    definition: { matcher: '*', hooks: [{ type: 'command', command: '' }] }
  },
  {
    eventName: 'PostToolUse',
    minVersion: '1.0.38',
    definition: { matcher: '*', hooks: [{ type: 'command', command: '' }] }
  },
  // Why: 2.1.119 is a conservative floor — PostToolUseFailure has no explicit
  // "Added" changelog entry; its first changelog mention is 2.1.119.
  {
    eventName: 'PostToolUseFailure',
    minVersion: '2.1.119',
    definition: { matcher: '*', hooks: [{ type: 'command', command: '' }] }
  },
  {
    eventName: 'PermissionRequest',
    minVersion: '2.0.45',
    definition: { matcher: '*', hooks: [{ type: 'command', command: '' }] }
  }
]

export function getConfigPath(settings = CLAUDE_HOOK_SETTINGS): string {
  return join(homedir(), settings.configDirName, 'settings.json')
}

export function getStatusLineScriptBaseName(settings = CLAUDE_HOOK_SETTINGS): string {
  return settings.scriptBaseName.replace(/-hook$/, '-statusline')
}

export function getStatusLineScriptFileName(settings = CLAUDE_HOOK_SETTINGS): string {
  return process.platform === 'win32'
    ? `${getStatusLineScriptBaseName(settings)}.cmd`
    : getPosixStatusLineScriptFileName(settings)
}

export function getPosixStatusLineScriptFileName(settings = CLAUDE_HOOK_SETTINGS): string {
  return `${getStatusLineScriptBaseName(settings)}.sh`
}

export function getStatusLineScriptPath(settings = CLAUDE_HOOK_SETTINGS): string {
  return getSharedManagedScriptPath(getStatusLineScriptFileName(settings))
}

export function getManagedScriptFileName(settings = CLAUDE_HOOK_SETTINGS): string {
  return process.platform === 'win32'
    ? `${settings.scriptBaseName}.cmd`
    : getPosixManagedScriptFileName(settings)
}

export function getPosixManagedScriptFileName(settings = CLAUDE_HOOK_SETTINGS): string {
  return `${settings.scriptBaseName}.sh`
}

export function getManagedScriptPath(settings = CLAUDE_HOOK_SETTINGS): string {
  return getSharedManagedScriptPath(getManagedScriptFileName(settings))
}

export function getRemoteConfigPath(remoteHome: string, settings = CLAUDE_HOOK_SETTINGS): string {
  return `${remoteHome.replace(/\/$/, '')}/${settings.configDirName}/settings.json`
}

export function getManagedCommand(scriptPath: string): string {
  return process.platform === 'win32'
    ? wrapWindowsGitBashHookCommand(scriptPath)
    : wrapPosixHookCommand(scriptPath)
}

export function getRemoteManagedCommand(scriptPath: string): string {
  return wrapPosixHookCommand(scriptPath)
}

export function applyManagedHooks(
  config: HooksConfig,
  command: string,
  scriptFileName = getManagedScriptFileName(),
  // Why: callers pass a version-gated subset so an older Claude Code client
  // never receives an event key it would reject; defaults to the full set.
  events: readonly ClaudeHookEventSpec[] = CLAUDE_EVENTS
): HooksConfig {
  const nextHooks = { ...config.hooks }
  const isManagedCommand = createManagedCommandMatcher(scriptFileName)

  for (const event of events) {
    const current = Array.isArray(nextHooks[event.eventName]) ? nextHooks[event.eventName] : []
    const cleaned = removeManagedCommands(current, isManagedCommand)
    const definition: HookDefinition = {
      ...event.definition,
      hooks: [buildManagedCommandHook(command)]
    }
    nextHooks[event.eventName] = [...cleaned, definition]
  }

  return { ...config, hooks: nextHooks }
}

export type StatusLineSlotState = 'managed' | 'user' | 'empty'

// Why: install policy needs "user owns the slot" vs "slot is empty" vs "ours" — an empty slot
// after a prior install means the user deleted the managed entry, which install must respect.
export function getStatusLineSlotState(
  config: HooksConfig,
  scriptFileName = getStatusLineScriptFileName()
): StatusLineSlotState {
  const isManagedCommand = createManagedCommandMatcher(scriptFileName)
  const current = config.statusLine
  const currentCommand =
    isPlainObject(current) && typeof current.command === 'string' ? current.command : null
  if (!currentCommand) {
    return 'empty'
  }
  return isManagedCommand(currentCommand) ? 'managed' : 'user'
}

// Why: records that the managed statusline was installed once, so a later empty slot reads as user opt-out.
export function getStatusLineInstallMarkerPath(settings = CLAUDE_HOOK_SETTINGS): string {
  return getSharedManagedScriptPath(`${getStatusLineScriptBaseName(settings)}.installed`)
}

// Why: statusLine is a single settings slot, not a hooks array — never overwrite a
// user-owned status line; the usage feed then simply falls back to the OAuth poll.
export function applyManagedStatusLine(
  config: HooksConfig,
  command: string,
  scriptFileName = getStatusLineScriptFileName()
): HooksConfig {
  if (getStatusLineSlotState(config, scriptFileName) === 'user') {
    return config
  }
  return { ...config, statusLine: { type: 'command', command } }
}

export function removeManagedStatusLine(
  config: HooksConfig,
  scriptFileName = getStatusLineScriptFileName()
): { config: HooksConfig; changed: boolean } {
  const isManagedCommand = createManagedCommandMatcher(scriptFileName)
  const current = config.statusLine
  const currentCommand =
    isPlainObject(current) && typeof current.command === 'string' ? current.command : null
  if (!currentCommand || !isManagedCommand(currentCommand)) {
    return { config, changed: false }
  }
  const next = { ...config }
  delete next.statusLine
  return { config: next, changed: true }
}

export function removeManagedHooks(
  config: HooksConfig,
  scriptFileName = getManagedScriptFileName()
): {
  config: HooksConfig
  changed: boolean
} {
  const nextHooks = { ...config.hooks }
  const isManagedCommand = createManagedCommandMatcher(scriptFileName)
  let changed = false

  for (const [eventName, definitions] of Object.entries(nextHooks)) {
    if (!Array.isArray(definitions)) {
      continue
    }
    const cleaned = removeManagedCommands(definitions, isManagedCommand)
    if (JSON.stringify(cleaned) !== JSON.stringify(definitions)) {
      changed = true
    }
    if (cleaned.length === 0) {
      delete nextHooks[eventName]
    } else {
      nextHooks[eventName] = cleaned
    }
  }

  return {
    config: { ...config, hooks: nextHooks },
    changed
  }
}
