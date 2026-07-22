import { lstatSync, readFileSync, existsSync, readdirSync, symlinkSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'

// Managed accounts run the Claude CLI against an isolated CLAUDE_CONFIG_DIR vault,
// so they never see the user's global ~/.claude.json MCP servers or ~/.claude/skills.
// These helpers seed that global config into a vault so a pinned account inherits
// the same MCP servers and skills the user configured globally.

export type VaultInheritableConfig = {
  mcpServers?: Record<string, unknown>
  [key: string]: unknown
}

export type VaultSkillsSeedResult = 'linked' | 'exists' | 'skipped'

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Reads the `mcpServers` map from a Claude JSON file (.claude.json / settings.json); {} when absent/unreadable. */
function readMcpServersFromFile(filePath: string): Record<string, unknown> {
  try {
    if (!existsSync(filePath)) {
      return {}
    }
    const parsed: unknown = JSON.parse(readFileSync(filePath, 'utf-8'))
    return isPlainObject(parsed) && isPlainObject(parsed.mcpServers) ? parsed.mcpServers : {}
  } catch {
    return {}
  }
}

/**
 * Reads standalone `<home>/.claude/mcp/<name>.json` server definitions. This is
 * where plugin-provided MCP servers (e.g. Engram) land as plain `{command,args}`
 * configs, so registering them as ordinary mcpServers avoids replicating the
 * whole plugin machinery into the isolated vault.
 */
function readMcpDirServers(homeDir: string): Record<string, unknown> {
  const dir = join(homeDir, '.claude', 'mcp')
  const servers: Record<string, unknown> = {}
  try {
    for (const entry of readdirSync(dir)) {
      if (!entry.endsWith('.json')) {
        continue
      }
      try {
        const parsed: unknown = JSON.parse(readFileSync(join(dir, entry), 'utf-8'))
        if (isPlainObject(parsed) && typeof parsed.command === 'string') {
          servers[entry.slice(0, -'.json'.length)] = parsed
        }
      } catch {
        // Skip an unreadable/malformed server file without failing the rest.
      }
    }
  } catch {
    // No ~/.claude/mcp directory — nothing to contribute.
  }
  return servers
}

/**
 * Collects the user's global MCP servers from every place Claude Code stores them:
 * user-scope `~/.claude.json`, `~/.claude/settings.json`, and the standalone
 * `~/.claude/mcp/*.json` files where plugin-provided servers (Engram, context7)
 * live. Reads the running machine's own home so each dev inherits their own
 * tooling. Returns a merged name→config map, or null when there are none.
 */
export function collectGlobalMcpServers(homeDir: string): Record<string, unknown> | null {
  const merged: Record<string, unknown> = {
    ...readMcpServersFromFile(join(homeDir, '.claude.json')),
    ...readMcpServersFromFile(join(homeDir, '.claude', 'settings.json')),
    ...readMcpDirServers(homeDir)
  }
  return Object.keys(merged).length > 0 ? merged : null
}

/**
 * Merges global `mcpServers` into a vault's .claude.json without clobbering the
 * other keys the CLI manages (oauthAccount, projects, history). Global entries
 * win for shared server names; vault-only entries are preserved. Returns the
 * serialized JSON to write, or null when no MCP entry actually changed (so the
 * caller can skip the write and keep the file's existing formatting intact).
 */
export function mergeMcpServersIntoVaultConfig(
  existingVaultJson: string | null,
  globalMcpServers: Record<string, unknown>
): string | null {
  let base: VaultInheritableConfig = {}
  if (existingVaultJson) {
    try {
      const parsed: unknown = JSON.parse(existingVaultJson)
      if (!isPlainObject(parsed)) {
        return null
      }
      base = parsed
    } catch {
      // Unparseable vault config — never clobber unknown content.
      return null
    }
  }
  const existingServers = isPlainObject(base.mcpServers) ? base.mcpServers : {}
  const changed = Object.entries(globalMcpServers).some(
    ([name, config]) => JSON.stringify(existingServers[name]) !== JSON.stringify(config)
  )
  if (!changed) {
    return null
  }
  const next: VaultInheritableConfig = {
    ...base,
    mcpServers: { ...existingServers, ...globalMcpServers }
  }
  return `${JSON.stringify(next, null, 2)}\n`
}

/**
 * Removes the `mcpServers` key from a vault's .claude.json so the account starts
 * clean (the user can then add their own from scratch). Preserves every other
 * CLI-managed key (oauthAccount, projects, history). Returns the serialized JSON
 * to write, or null when there was nothing to remove.
 */
export function clearMcpServersFromVaultConfig(existingVaultJson: string | null): string | null {
  if (!existingVaultJson) {
    return null
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(existingVaultJson)
  } catch {
    // Unparseable vault config — never clobber unknown content.
    return null
  }
  if (!isPlainObject(parsed) || !('mcpServers' in parsed)) {
    return null
  }
  const next: VaultInheritableConfig = { ...parsed }
  delete next.mcpServers
  return `${JSON.stringify(next, null, 2)}\n`
}

/** Removes `<vault>/skills` only when it is our symlink; leaves a real directory alone. Returns true if unlinked. */
export function removeVaultSkillsSymlink(vaultAuthPath: string): boolean {
  const linkPath = join(vaultAuthPath, 'skills')
  try {
    if (!lstatSync(linkPath).isSymbolicLink()) {
      return false
    }
    unlinkSync(linkPath)
    return true
  } catch {
    return false
  }
}

/**
 * Points <vault>/skills at the user's global ~/.claude/skills via a symlink so a
 * pinned account inherits global skills live (edits to the global folder show up
 * immediately). Skips when there are no global skills, and never clobbers an
 * existing entry the CLI may have created. Uses a junction on Windows so no
 * elevated privilege is required for the directory link.
 */
export function ensureVaultSkillsSymlink(
  vaultAuthPath: string,
  homeDir: string
): VaultSkillsSeedResult {
  const globalSkills = join(homeDir, '.claude', 'skills')
  if (!existsSync(globalSkills)) {
    return 'skipped'
  }
  const linkPath = join(vaultAuthPath, 'skills')
  try {
    lstatSync(linkPath)
    // Something already occupies <vault>/skills (dir, file, or link) — leave it.
    return 'exists'
  } catch {
    // Nothing there — safe to create the link below.
  }
  try {
    symlinkSync(globalSkills, linkPath, process.platform === 'win32' ? 'junction' : 'dir')
    return 'linked'
  } catch {
    return 'skipped'
  }
}
