export const ORCA_SKILLS_REPOSITORY_URL = 'https://github.com/stablyai/orca'
// Why: orca-plane ships only in this lab fork, not the official Orca repo, so its
// skill must be fetched from the fork (see PLANE skill install command below).
export const ORCA_LAB_SKILLS_REPOSITORY_URL = 'https://github.com/ab2webco/orca-oss'

export const ORCA_CLI_SKILL_NAME = 'orca-cli'
export const COMPUTER_USE_SKILL_NAME = 'computer-use'
export const ORCHESTRATION_SKILL_NAME = 'orchestration'
export const EPHEMERAL_VMS_SKILL_NAME = 'orca-per-workspace-env'
export const ORCA_LINEAR_SKILL_NAME = 'orca-linear'
export const LINEAR_TICKETS_SKILL_NAME = 'linear-tickets'
export const LINEAR_AGENT_SKILL_NAMES = [ORCA_LINEAR_SKILL_NAME, LINEAR_TICKETS_SKILL_NAME] as const
export const ORCA_PLANE_SKILL_NAME = 'orca-plane'
export const PLANE_AGENT_SKILL_NAMES = [ORCA_PLANE_SKILL_NAME] as const

export function buildAgentFeatureSkillInstallCommand(
  skillNames: readonly string[],
  repositoryUrl: string = ORCA_SKILLS_REPOSITORY_URL
): string {
  if (skillNames.length === 0) {
    throw new Error('At least one skill name is required.')
  }
  return `npx skills add ${repositoryUrl} --skill ${skillNames.join(' ')} --global`
}

export function buildAgentFeatureSkillUpdateCommand(skillName: string): string {
  const trimmedSkillName = skillName.trim()
  if (!trimmedSkillName) {
    throw new Error('A skill name is required.')
  }
  return `npx skills update ${trimmedSkillName} --global`
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

export const LINEAR_TICKETS_SKILL_INSTALL_COMMAND = buildAgentFeatureSkillInstallCommand([
  LINEAR_TICKETS_SKILL_NAME
])

export const LINEAR_TICKETS_SKILL_UPDATE_COMMAND =
  buildAgentFeatureSkillUpdateCommand(LINEAR_TICKETS_SKILL_NAME)

export const ORCA_PLANE_SKILL_INSTALL_COMMAND = buildAgentFeatureSkillInstallCommand(
  [ORCA_PLANE_SKILL_NAME],
  ORCA_LAB_SKILLS_REPOSITORY_URL
)

export const ORCA_PLANE_SKILL_UPDATE_COMMAND =
  buildAgentFeatureSkillUpdateCommand(ORCA_PLANE_SKILL_NAME)
