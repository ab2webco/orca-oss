import { isSkillsCliAgentKeyShaped, SKILLS_CLI_UNIVERSAL_AGENT_KEY } from './skills-cli-agent-keys'
import { ORCA_REPOSITORY_URL } from './orca-repository-url'

export const ORCA_SKILLS_REPOSITORY_URL = ORCA_REPOSITORY_URL

export const ORCA_CLI_SKILL_NAME = 'orca-cli'
export const COMPUTER_USE_SKILL_NAME = 'computer-use'
export const ORCHESTRATION_SKILL_NAME = 'orchestration'
export const EPHEMERAL_VMS_SKILL_NAME = 'orca-per-workspace-env'
export const ORCA_LINEAR_SKILL_NAME = 'orca-linear'
export const LINEAR_TICKETS_SKILL_NAME = 'linear-tickets'
export const LINEAR_AGENT_SKILL_NAMES = [ORCA_LINEAR_SKILL_NAME, LINEAR_TICKETS_SKILL_NAME] as const
export const ORCA_PLANE_SKILL_NAME = 'orca-plane'
export const PLANE_AGENT_SKILL_NAMES = [ORCA_PLANE_SKILL_NAME] as const
export const SWITCH_ACCOUNT_SKILL_NAME = 'switch-account'
export const SWITCH_ACCOUNT_AGENT_SKILL_NAMES = [SWITCH_ACCOUNT_SKILL_NAME] as const
export const ORCA_GAME_SCENES_SKILL_NAME = 'orca-game-scenes'
export const ORCA_GAME_SCENES_AGENT_SKILL_NAMES = [ORCA_GAME_SCENES_SKILL_NAME] as const

// Why: every skill Orca installs comes from the fork, which ships all of them.
// The name set is what decides `skills add` (re-points an upstream install) versus
// `skills update` (follows whatever source the install recorded).
export const ORCA_SHIPPED_SKILL_NAMES: ReadonlySet<string> = new Set<string>([
  ORCA_CLI_SKILL_NAME,
  COMPUTER_USE_SKILL_NAME,
  ORCHESTRATION_SKILL_NAME,
  EPHEMERAL_VMS_SKILL_NAME,
  ORCA_LINEAR_SKILL_NAME,
  LINEAR_TICKETS_SKILL_NAME,
  ORCA_PLANE_SKILL_NAME,
  SWITCH_ACCOUNT_SKILL_NAME,
  ORCA_GAME_SCENES_SKILL_NAME,
  'orca-emulator',
  'orca-emulator-android'
])

export function resolveAgentFeatureSkillRepositoryUrl(_skillName: string): string {
  return ORCA_SKILLS_REPOSITORY_URL
}

export type AgentFeatureSkillRepositoryGroup = {
  repositoryUrl: string
  skillNames: string[]
}

/** Groups names by source repo, in first-seen order; `skills add` takes one repo. */
export function groupAgentFeatureSkillNamesByRepository(
  skillNames: readonly string[]
): AgentFeatureSkillRepositoryGroup[] {
  const groups = new Map<string, AgentFeatureSkillRepositoryGroup>()
  for (const skillName of skillNames) {
    const repositoryUrl = resolveAgentFeatureSkillRepositoryUrl(skillName)
    const group = groups.get(repositoryUrl)
    if (!group) {
      groups.set(repositoryUrl, { repositoryUrl, skillNames: [skillName] })
    } else if (!group.skillNames.includes(skillName)) {
      group.skillNames.push(skillName)
    }
  }
  return [...groups.values()]
}

// Why: dropping the odd one out or sending both to one URL are the two silent
// failures here, so a caller that has not grouped is refused rather than guessed at.
function resolveSoleRepositoryUrl(skillNames: readonly string[]): string {
  const groups = groupAgentFeatureSkillNamesByRepository(skillNames)
  const [sole] = groups
  if (!sole || groups.length > 1) {
    throw new Error(
      'Skills from more than one repository cannot share one install command. ' +
        'Use buildAgentFeatureSkillInstallArgsByRepository instead.'
    )
  }
  return sole.repositoryUrl
}

// Why: `yes` and `agents` default off so every Settings/onboarding string a human
// pastes keeps its interactive prompts and the CLI's own agent detection. Only an
// unattended spawn, which nothing can answer, opts in.
export type AgentFeatureSkillCommandOptions = {
  global?: boolean
  yes?: boolean
  agents?: readonly string[]
  /** Source repo for `skills add`; defaults to the fork. */
  repositoryUrl?: string
  /** Unattended update: the agent homes each Orca skill sits in, so every copy is re-pointed. */
  repointAgentsBySkill?: Readonly<Record<string, readonly string[]>>
}

export function buildAgentFeatureSkillInstallArgs(
  skillNames: readonly string[],
  options: AgentFeatureSkillCommandOptions = {}
): string[] {
  if (skillNames.length === 0) {
    throw new Error('At least one skill name is required.')
  }
  const global = options.global ?? true
  // Why: -y with no --agent is the one combination that makes `skills add` install
  // into every agent it knows. Refuse it here so no caller can express it.
  const agents = options.agents ?? []
  if (options.yes && agents.length === 0) {
    throw new Error('An install target is required when skipping prompts.')
  }
  // Why: a value the skills CLI would drop leaves it with no target at all, which
  // is the same all-agents install as passing no --agent.
  const unusable = agents.find((agent) => !isSkillsCliAgentKeyShaped(agent))
  if (unusable !== undefined) {
    throw new Error(`"${unusable}" is not a usable install target.`)
  }
  // Why: one flag per name remains compatible with both single-value and variadic parsers.
  const skillArgs = skillNames.flatMap((name) => ['--skill', name])
  return [
    'skills',
    'add',
    options.repositoryUrl ?? resolveSoleRepositoryUrl(skillNames),
    ...skillArgs,
    ...(global ? ['--global'] : []),
    // Why: an explicit --agent stops `skills add` calling its own detection, whose
    // zero-detected branch installs into all ~75 known agents and litters a bare
    // host with agent config directories it has no agent for.
    ...agents.flatMap((agent) => ['--agent', agent]),
    // Why: without -y `skills add` opens an interactive agent picker and blocks
    // forever on any TTY, which is every ssh session.
    ...(options.yes ? ['-y'] : [])
  ]
}

/** One argv per source repo, so a mixed request installs from both rather than one. */
export function buildAgentFeatureSkillInstallArgsByRepository(
  skillNames: readonly string[],
  options: AgentFeatureSkillCommandOptions = {}
): string[][] {
  if (skillNames.length === 0) {
    throw new Error('At least one skill name is required.')
  }
  if (options.repositoryUrl !== undefined) {
    return [buildAgentFeatureSkillInstallArgs(skillNames, options)]
  }
  return groupAgentFeatureSkillNamesByRepository(skillNames).map((group) =>
    buildAgentFeatureSkillInstallArgs(group.skillNames, {
      ...options,
      repositoryUrl: group.repositoryUrl
    })
  )
}

export function buildAgentFeatureSkillInstallCommand(
  skillNames: readonly string[],
  options: AgentFeatureSkillCommandOptions = {}
): string {
  return `npx ${buildAgentFeatureSkillInstallArgs(skillNames, options).join(' ')}`
}

export function buildAgentFeatureSkillUpdateArgs(
  skillNames: string | readonly string[],
  options: AgentFeatureSkillCommandOptions = {}
): string[] {
  const rawNames = typeof skillNames === 'string' ? [skillNames] : skillNames
  const names = rawNames.map((name) => name.trim()).filter((name) => name.length > 0)
  if (names.length === 0) {
    throw new Error('A skill name is required.')
  }
  const global = options.global ?? true
  const shipped = names.filter((name) => ORCA_SHIPPED_SKILL_NAMES.has(name))
  if (shipped.length > 0) {
    if (shipped.length !== names.length) {
      throw new Error('Skills from the fork cannot share one update command with other skills.')
    }
    // Why: `skills update` keeps the upstream source recorded at install; re-adding from
    // the fork is what re-points it. Unattended runs pin the canonical target, as the
    // runner does, because `-y` without a target installs into every agent.
    return buildAgentFeatureSkillInstallArgs(names, {
      global,
      yes: options.yes,
      agents: options.yes ? [SKILLS_CLI_UNIVERSAL_AGENT_KEY] : [],
      repositoryUrl: ORCA_SKILLS_REPOSITORY_URL
    })
  }
  return [
    'skills',
    'update',
    ...names,
    global ? '--global' : '--project',
    ...(options.yes ? ['-y'] : [])
  ]
}

export function buildAgentFeatureSkillUpdateCommand(
  skillNames: string | readonly string[],
  options: AgentFeatureSkillCommandOptions = {}
): string {
  return `npx ${buildAgentFeatureSkillUpdateArgs(skillNames, options).join(' ')}`
}

/**
 * One argv per `skills` invocation for an update of any mix of names: Orca-shipped
 * skills are re-added from the fork, the rest are updated as their lock recorded them.
 */
export function buildAgentFeatureSkillUpdateStepArgs(
  skillNames: readonly string[],
  options: AgentFeatureSkillCommandOptions = {}
): string[][] {
  const names = skillNames.map((name) => name.trim()).filter((name) => name.length > 0)
  if (names.length === 0) {
    throw new Error('A skill name is required.')
  }
  const shipped = names.filter((name) => ORCA_SHIPPED_SKILL_NAMES.has(name))
  const others = names.filter((name) => !ORCA_SHIPPED_SKILL_NAMES.has(name))
  const steps: string[][] = []
  // Why: an unattended re-point with no target would install into every agent.
  const fallback = options.agents?.length ? options.agents : [SKILLS_CLI_UNIVERSAL_AGENT_KEY]
  // Why: naming only `universal` leaves an independent provider copy on upstream bytes,
  // so each skill names the homes it sits in. Skills sharing a target set share one
  // command; one set for all would add a skill to homes that never had it.
  const groups = new Map<string, { agents: readonly string[]; names: string[] }>()
  for (const name of shipped) {
    const agents = options.yes
      ? [...(options.repointAgentsBySkill?.[name] ?? fallback)].sort()
      : (options.agents ?? [])
    const key = agents.join(' ')
    const group = groups.get(key)
    if (group) {
      group.names.push(name)
    } else {
      groups.set(key, { agents, names: [name] })
    }
  }
  for (const group of groups.values()) {
    steps.push(
      buildAgentFeatureSkillInstallArgs(group.names, {
        global: options.global,
        yes: options.yes,
        agents: group.agents,
        repositoryUrl: ORCA_SKILLS_REPOSITORY_URL
      })
    )
  }
  if (others.length > 0) {
    steps.push(buildAgentFeatureSkillUpdateArgs(others, options))
  }
  return steps
}

export const ORCA_CLI_SKILL_INSTALL_COMMAND = buildAgentFeatureSkillInstallCommand([
  ORCA_CLI_SKILL_NAME
])

export const ORCA_CLI_SKILL_UPDATE_COMMAND =
  buildAgentFeatureSkillUpdateCommand(ORCA_CLI_SKILL_NAME)

export const COMPUTER_USE_SKILL_INSTALL_COMMAND = buildAgentFeatureSkillInstallCommand([
  COMPUTER_USE_SKILL_NAME
])

export const COMPUTER_USE_SKILL_UPDATE_COMMAND =
  buildAgentFeatureSkillUpdateCommand(COMPUTER_USE_SKILL_NAME)

export const ORCHESTRATION_SKILL_INSTALL_COMMAND = buildAgentFeatureSkillInstallCommand([
  ORCHESTRATION_SKILL_NAME
])

export const ORCHESTRATION_SKILL_UPDATE_COMMAND =
  buildAgentFeatureSkillUpdateCommand(ORCHESTRATION_SKILL_NAME)

export const EPHEMERAL_VMS_SKILL_INSTALL_COMMAND = buildAgentFeatureSkillInstallCommand([
  EPHEMERAL_VMS_SKILL_NAME
])

export const EPHEMERAL_VMS_SKILL_UPDATE_COMMAND =
  buildAgentFeatureSkillUpdateCommand(EPHEMERAL_VMS_SKILL_NAME)

export const ORCA_CLI_ORCHESTRATION_SKILL_INSTALL_COMMAND = buildAgentFeatureSkillInstallCommand([
  ORCA_CLI_SKILL_NAME,
  ORCHESTRATION_SKILL_NAME
])

export const ORCA_LINEAR_SKILL_INSTALL_COMMAND = buildAgentFeatureSkillInstallCommand([
  ORCA_LINEAR_SKILL_NAME
])

export const ORCA_LINEAR_SKILL_UPDATE_COMMAND =
  buildAgentFeatureSkillUpdateCommand(ORCA_LINEAR_SKILL_NAME)

export const LINEAR_TICKETS_SKILL_UPDATE_COMMAND =
  buildAgentFeatureSkillUpdateCommand(LINEAR_TICKETS_SKILL_NAME)

export const ORCA_PLANE_SKILL_INSTALL_COMMAND = buildAgentFeatureSkillInstallCommand([
  ORCA_PLANE_SKILL_NAME
])

export const ORCA_PLANE_SKILL_UPDATE_COMMAND =
  buildAgentFeatureSkillUpdateCommand(ORCA_PLANE_SKILL_NAME)

export const SWITCH_ACCOUNT_SKILL_INSTALL_COMMAND = buildAgentFeatureSkillInstallCommand([
  SWITCH_ACCOUNT_SKILL_NAME
])

export const SWITCH_ACCOUNT_SKILL_UPDATE_COMMAND =
  buildAgentFeatureSkillUpdateCommand(SWITCH_ACCOUNT_SKILL_NAME)

export const ORCA_GAME_SCENES_SKILL_INSTALL_COMMAND = buildAgentFeatureSkillInstallCommand([
  ORCA_GAME_SCENES_SKILL_NAME
])

export const ORCA_GAME_SCENES_SKILL_UPDATE_COMMAND = buildAgentFeatureSkillUpdateCommand(
  ORCA_GAME_SCENES_SKILL_NAME
)
