import type { ClaudeVaultSettingInheritanceKey } from '../../shared/types'

// A pinned session runs Claude against an isolated CLAUDE_CONFIG_DIR vault, so
// `~/.claude/settings.json` is never read there. These helpers pick the keys that
// belong to the *user and their machine* rather than to the *identity*, and merge
// only those into a vault's settings.json.
//
// The frontier, and why each side of it:
//
//   inherited — the user configured them once and they mean the same thing under
//   every identity: `permissions` (what agents may do on this machine),
//   `attribution` + `includeCoAuthoredBy` (this project's no-AI-attribution rule),
//   `skillOverrides`, `agentPushNotifEnabled`, `outputStyle` (how the user reads).
//
//   NOT inherited — `env` (a custom-endpoint vault keeps its API token there),
//   `statusLine` and `hooks` (Orca's own vault instrumentation: overwriting them
//   loses session-id capture and usage posting; user plugin hooks have their own
//   opt-in sync), `mcpServers` (already inherited through the vault's .claude.json),
//   and the per-vault knobs the CLI itself writes back from inside a session
//   (`theme`, `model`, `effortLevel`, `advisorModel`, `tui`, `autoMemoryEnabled`,
//   `skipDangerousModePermissionPrompt`, `enabledPlugins`, `extraKnownMarketplaces`).

export const INHERITABLE_VAULT_SETTING_KEYS: readonly ClaudeVaultSettingInheritanceKey[] = [
  'permissions',
  'attribution',
  'includeCoAuthoredBy',
  'skillOverrides',
  'agentPushNotifEnabled',
  'outputStyle'
]

/** Permission lists are unioned, never replaced — a replace that dropped a
 *  vault-local `deny` would silently *weaken* a restriction the user set. */
const UNIONED_PERMISSION_LISTS = ['allow', 'ask', 'deny'] as const

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Parses a settings.json string; null when absent, unreadable, or not an object
 *  (callers must never clobber content they could not understand). */
export function parseSettingsObject(json: string | null): Record<string, unknown> | null {
  // An empty or whitespace-only file is a vault with nothing in it yet, not
  // content we failed to understand — refusing it would strand inheritance.
  if (json === null || json.trim().length === 0) {
    return {}
  }
  try {
    const parsed: unknown = JSON.parse(json)
    return isPlainObject(parsed) ? parsed : null
  } catch {
    return null
  }
}

/** The inheritable subset of the user's home settings, keys absent at home omitted. */
export function selectInheritableSettings(
  homeSettings: Record<string, unknown>
): Partial<Record<ClaudeVaultSettingInheritanceKey, unknown>> {
  const selected: Partial<Record<ClaudeVaultSettingInheritanceKey, unknown>> = {}
  for (const key of INHERITABLE_VAULT_SETTING_KEYS) {
    if (key in homeSettings && homeSettings[key] !== undefined) {
      selected[key] = homeSettings[key]
    }
  }
  return selected
}

function unionStringLists(vaultList: unknown, homeList: unknown): string[] | null {
  const vaultEntries = Array.isArray(vaultList) ? vaultList.filter(isStringEntry) : null
  const homeEntries = Array.isArray(homeList) ? homeList.filter(isStringEntry) : null
  if (vaultEntries === null && homeEntries === null) {
    return null
  }
  const merged = [...(vaultEntries ?? [])]
  for (const entry of homeEntries ?? []) {
    if (!merged.includes(entry)) {
      merged.push(entry)
    }
  }
  return merged
}

function isStringEntry(value: unknown): value is string {
  return typeof value === 'string'
}

/** `permissions` is the one asymmetric key: `defaultMode` (and any future scalar)
 *  takes the home value, while the allow/ask/deny lists are unioned. */
function mergePermissions(vaultValue: unknown, homeValue: unknown): unknown {
  if (!isPlainObject(homeValue)) {
    return homeValue
  }
  if (!isPlainObject(vaultValue)) {
    return homeValue
  }
  const merged: Record<string, unknown> = { ...vaultValue, ...homeValue }
  for (const list of UNIONED_PERMISSION_LISTS) {
    const union = unionStringLists(vaultValue[list], homeValue[list])
    if (union !== null) {
      merged[list] = union
    }
  }
  return merged
}

function mergeKey(
  key: ClaudeVaultSettingInheritanceKey,
  vaultValue: unknown,
  homeValue: unknown
): unknown {
  if (key === 'permissions') {
    return mergePermissions(vaultValue, homeValue)
  }
  // skillOverrides is a name→override map: keep vault-only entries, home wins per skill.
  if (key === 'skillOverrides' && isPlainObject(vaultValue) && isPlainObject(homeValue)) {
    return { ...vaultValue, ...homeValue }
  }
  return homeValue
}

/**
 * Applies the inheritable home settings onto a parsed vault settings object.
 * Returns the next object plus whether anything actually changed, so a caller can
 * skip the write and keep the file's existing formatting.
 */
export function applyInheritableSettings(
  vaultSettings: Record<string, unknown>,
  inheritable: Partial<Record<ClaudeVaultSettingInheritanceKey, unknown>>
): { settings: Record<string, unknown>; changed: boolean } {
  const next: Record<string, unknown> = { ...vaultSettings }
  let changed = false
  for (const [key, homeValue] of Object.entries(inheritable) as [
    ClaudeVaultSettingInheritanceKey,
    unknown
  ][]) {
    const merged = mergeKey(key, vaultSettings[key], homeValue)
    if (JSON.stringify(merged) !== JSON.stringify(vaultSettings[key])) {
      changed = true
    }
    next[key] = merged
  }
  return { settings: next, changed }
}

/**
 * Serialized-string variant for the vault settings.json. Returns null when nothing
 * changed (skip the write) or when the existing content is unparseable — a vault
 * settings.json can hold a custom-endpoint token, so unknown content is never
 * clobbered. Idempotent: re-running against its own output changes nothing.
 */
export function mergeUserSettingsIntoVaultSettings(
  existingSettingsJson: string | null,
  inheritable: Partial<Record<ClaudeVaultSettingInheritanceKey, unknown>>
): string | null {
  if (Object.keys(inheritable).length === 0) {
    return null
  }
  const base = parseSettingsObject(existingSettingsJson)
  if (base === null) {
    return null
  }
  const { settings, changed } = applyInheritableSettings(base, inheritable)
  return changed ? `${JSON.stringify(settings, null, 2)}\n` : null
}

/**
 * Per-key state of one vault against the user's home file, for `orca account list`.
 * `inherited` = the vault already carries the home value; `stale` = home changed
 * after this vault was last seeded, so the running session does not have it.
 */
export function describeSettingInheritance(
  vaultSettings: Record<string, unknown>,
  inheritable: Partial<Record<ClaudeVaultSettingInheritanceKey, unknown>>,
  key: ClaudeVaultSettingInheritanceKey
): 'inherited' | 'stale' | 'absent' {
  if (!(key in inheritable)) {
    return 'absent'
  }
  const merged = mergeKey(key, vaultSettings[key], inheritable[key])
  return JSON.stringify(merged) === JSON.stringify(vaultSettings[key]) ? 'inherited' : 'stale'
}
