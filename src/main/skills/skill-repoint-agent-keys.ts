import { lstat } from 'node:fs/promises'
import { join } from 'node:path'
import { ORCA_SHIPPED_SKILL_NAMES } from '../../shared/agent-feature-install-commands'
import {
  SKILLS_CLI_AGENT_KEY_BY_TUI_AGENT,
  SKILLS_CLI_UNIVERSAL_AGENT_KEY
} from '../../shared/skills-cli-agent-keys'
import { buildSkillDiscoverySources } from './skill-discovery-sources'

const AGENT_KEY_BY_OWNER: Readonly<Record<string, string | null>> =
  SKILLS_CLI_AGENT_KEY_BY_TUI_AGENT

// Why: the shared home has no owner and is what `universal` writes; an owner the skills
// CLI has no key for cannot be named, so it is left out rather than guessed.
function agentKeyForOwner(owner: string | null): string | null {
  if (owner === null) {
    return SKILLS_CLI_UNIVERSAL_AGENT_KEY
  }
  return Object.hasOwn(AGENT_KEY_BY_OWNER, owner) ? AGENT_KEY_BY_OWNER[owner] : null
}

// Why: lstat, not stat — a link into the canonical copy is a placement even when dangling.
async function pathExists(path: string): Promise<boolean> {
  try {
    await lstat(path)
    return true
  } catch {
    return false
  }
}

/**
 * The `skills --agent` keys of every global agent home that holds each Orca-shipped
 * skill, plus `universal`. A re-point naming only `universal` rewrites the canonical
 * copy and leaves an independent copy in a provider home on upstream bytes.
 */
export async function findSkillRepointAgentKeys(
  skillNames: readonly string[],
  options: { homeDir?: string } = {}
): Promise<Record<string, string[]>> {
  const homeRoots = buildSkillDiscoverySources({
    homeDir: options.homeDir,
    repos: [],
    includeCwd: false
  }).filter((root) => root.sourceKind === 'home')
  const result: Record<string, string[]> = {}
  // Why: only names Orca ships are joined onto a path, so a requested name can never
  // walk out of a skills home.
  for (const name of skillNames.filter((skillName) => ORCA_SHIPPED_SKILL_NAMES.has(skillName))) {
    const keys = new Set<string>([SKILLS_CLI_UNIVERSAL_AGENT_KEY])
    await Promise.all(
      homeRoots.map(async (root) => {
        const key = agentKeyForOwner(root.owner)
        if (key && (await pathExists(join(root.path, name)))) {
          keys.add(key)
        }
      })
    )
    result[name] = [...keys].sort()
  }
  return result
}
