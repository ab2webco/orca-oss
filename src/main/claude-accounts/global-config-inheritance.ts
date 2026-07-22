import { lstatSync, readFileSync, existsSync, symlinkSync } from 'node:fs'
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

/** Reads the user's global `mcpServers` map from ~/.claude.json; null when absent/unreadable/empty. */
export function readGlobalMcpServers(homeDir: string): Record<string, unknown> | null {
  const globalConfigPath = join(homeDir, '.claude.json')
  try {
    if (!existsSync(globalConfigPath)) {
      return null
    }
    const parsed: unknown = JSON.parse(readFileSync(globalConfigPath, 'utf-8'))
    if (!isPlainObject(parsed) || !isPlainObject(parsed.mcpServers)) {
      return null
    }
    return Object.keys(parsed.mcpServers).length > 0 ? parsed.mcpServers : null
  } catch {
    return null
  }
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
