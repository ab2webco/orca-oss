import { describe, expect, it } from 'vitest'
import {
  buildAgentFeatureSkillInstallArgs,
  buildAgentFeatureSkillInstallArgsByRepository,
  buildAgentFeatureSkillInstallCommand,
  groupAgentFeatureSkillNamesByRepository,
  resolveAgentFeatureSkillRepositoryUrl,
  ORCA_CLI_SKILL_INSTALL_COMMAND,
  buildAgentFeatureSkillUpdateArgs,
  buildAgentFeatureSkillUpdateCommand,
  buildAgentFeatureSkillUpdateStepArgs,
  COMPUTER_USE_SKILL_UPDATE_COMMAND,
  EPHEMERAL_VMS_SKILL_UPDATE_COMMAND,
  LINEAR_TICKETS_SKILL_UPDATE_COMMAND,
  ORCA_LINEAR_SKILL_UPDATE_COMMAND,
  ORCA_CLI_ORCHESTRATION_SKILL_INSTALL_COMMAND,
  ORCA_CLI_SKILL_UPDATE_COMMAND,
  ORCHESTRATION_SKILL_UPDATE_COMMAND,
  ORCA_PLANE_SKILL_INSTALL_COMMAND,
  SWITCH_ACCOUNT_SKILL_INSTALL_COMMAND,
  SWITCH_ACCOUNT_SKILL_UPDATE_COMMAND,
  ORCA_GAME_SCENES_AGENT_SKILL_NAMES,
  ORCA_GAME_SCENES_SKILL_INSTALL_COMMAND,
  ORCA_GAME_SCENES_SKILL_UPDATE_COMMAND,
  ORCA_SHIPPED_SKILL_NAMES
} from './agent-feature-install-commands'

describe('agent feature skill commands', () => {
  it('builds a global install command by default', () => {
    expect(buildAgentFeatureSkillInstallCommand(['orca-cli'])).toBe(
      'npx skills add https://github.com/ab2webco/orca-oss --skill orca-cli --global'
    )
  })

  it('drops --global when installing locally', () => {
    expect(buildAgentFeatureSkillInstallCommand(['orca-cli'], { global: false })).toBe(
      'npx skills add https://github.com/ab2webco/orca-oss --skill orca-cli'
    )
  })

  it('repeats --skill per name for multi-skill installs', () => {
    expect(buildAgentFeatureSkillInstallCommand(['orca-cli', 'orchestration'])).toBe(
      'npx skills add https://github.com/ab2webco/orca-oss --skill orca-cli --skill orchestration --global'
    )
    expect(buildAgentFeatureSkillInstallArgs(['orca-cli', 'orchestration'])).toEqual([
      'skills',
      'add',
      'https://github.com/ab2webco/orca-oss',
      '--skill',
      'orca-cli',
      '--skill',
      'orchestration',
      '--global'
    ])
  })

  it('keeps the copyable Settings commands interactive by default', () => {
    // Why: -y skips the agent picker. A human pasting from Settings should still
    // get it; only an unattended spawn opts in.
    expect(buildAgentFeatureSkillInstallCommand(['orca-cli'])).not.toContain('-y')
    expect(buildAgentFeatureSkillUpdateCommand('orca-cli')).not.toContain('-y')
    expect(ORCA_CLI_SKILL_INSTALL_COMMAND).not.toContain('-y')
    expect(ORCA_CLI_SKILL_UPDATE_COMMAND).not.toContain('-y')
  })

  it('refuses to skip prompts without an install target', () => {
    // Why: -y with no --agent is the one combination that makes `skills add`
    // install into every agent it knows (~75). No caller may express it.
    expect(() => buildAgentFeatureSkillInstallCommand(['orca-cli'], { yes: true })).toThrow(
      'An install target is required when skipping prompts.'
    )
  })

  it('refuses a target the skills CLI would drop', () => {
    // Why: defence in depth behind the CLI's own check — the skills CLI silently
    // drops a `-`-leading --agent value, which empties its target list and
    // installs into every agent it knows.
    expect(() =>
      buildAgentFeatureSkillInstallCommand(['orca-cli'], { yes: true, agents: ['-y'] })
    ).toThrow('"-y" is not a usable install target.')
    expect(() =>
      buildAgentFeatureSkillInstallArgs(['orca-cli'], { yes: true, agents: ['universal', 'a b'] })
    ).toThrow('"a b" is not a usable install target.')
  })

  it('appends -y and the targets for an unattended run', () => {
    expect(
      buildAgentFeatureSkillInstallCommand(['orca-cli'], { yes: true, agents: ['universal'] })
    ).toBe(
      'npx skills add https://github.com/ab2webco/orca-oss --skill orca-cli --global --agent universal -y'
    )
    // Why: an unattended fork update pins the canonical target, as the runner does.
    expect(buildAgentFeatureSkillUpdateCommand(['orca-cli'], { global: false, yes: true })).toBe(
      'npx skills add https://github.com/ab2webco/orca-oss --skill orca-cli --agent universal -y'
    )
    expect(
      buildAgentFeatureSkillInstallArgs(['orca-cli'], { yes: true, agents: ['universal'] }).at(-1)
    ).toBe('-y')
    expect(buildAgentFeatureSkillUpdateArgs(['orca-cli'], { yes: true }).at(-1)).toBe('-y')
  })

  it('builds single-skill update commands', () => {
    expect(buildAgentFeatureSkillUpdateCommand('orchestration')).toBe(
      'npx skills add https://github.com/ab2webco/orca-oss --skill orchestration --global'
    )
  })

  it('trims and rejects blank update skill names', () => {
    expect(buildAgentFeatureSkillUpdateCommand('  orca-cli  ')).toBe(
      'npx skills add https://github.com/ab2webco/orca-oss --skill orca-cli --global'
    )
    expect(() => buildAgentFeatureSkillUpdateCommand('   ')).toThrow('A skill name is required.')
  })

  it('builds multi-skill update commands and selects project scope for --local', () => {
    expect(buildAgentFeatureSkillUpdateCommand(['orca-cli', 'orchestration'])).toBe(
      'npx skills add https://github.com/ab2webco/orca-oss --skill orca-cli --skill orchestration --global'
    )
    expect(buildAgentFeatureSkillUpdateCommand(['orca-cli'], { global: false })).toBe(
      'npx skills add https://github.com/ab2webco/orca-oss --skill orca-cli'
    )
    expect(buildAgentFeatureSkillUpdateArgs(['orca-cli'], { global: false })).toEqual([
      'skills',
      'add',
      'https://github.com/ab2webco/orca-oss',
      '--skill',
      'orca-cli'
    ])
    expect(() => buildAgentFeatureSkillUpdateCommand([])).toThrow('A skill name is required.')
  })

  it('updates Orca-shipped skills from the fork, so an upstream install re-points to it', () => {
    // Why: `skills update` follows the source recorded at install time, so an
    // upstream install would keep pulling upstream forever. Re-running `skills add`
    // from the fork rewrites that recorded source.
    expect(ORCA_CLI_SKILL_UPDATE_COMMAND).toBe(
      'npx skills add https://github.com/ab2webco/orca-oss --skill orca-cli --global'
    )
    expect(COMPUTER_USE_SKILL_UPDATE_COMMAND).toBe(
      'npx skills add https://github.com/ab2webco/orca-oss --skill computer-use --global'
    )
    expect(ORCHESTRATION_SKILL_UPDATE_COMMAND).toBe(
      'npx skills add https://github.com/ab2webco/orca-oss --skill orchestration --global'
    )
    expect(EPHEMERAL_VMS_SKILL_UPDATE_COMMAND).toBe(
      'npx skills add https://github.com/ab2webco/orca-oss --skill orca-per-workspace-env --global'
    )
    expect(ORCA_LINEAR_SKILL_UPDATE_COMMAND).toBe(
      'npx skills add https://github.com/ab2webco/orca-oss --skill orca-linear --global'
    )
    expect(LINEAR_TICKETS_SKILL_UPDATE_COMMAND).toBe(
      'npx skills add https://github.com/ab2webco/orca-oss --skill linear-tickets --global'
    )
    expect(ORCA_CLI_ORCHESTRATION_SKILL_INSTALL_COMMAND).toBe(
      buildAgentFeatureSkillInstallCommand(['orca-cli', 'orchestration'])
    )
  })

  it('keeps `skills update` for skills Orca does not ship', () => {
    expect(buildAgentFeatureSkillUpdateCommand('find-skills')).toBe(
      'npx skills update find-skills --global'
    )
  })

  it('refuses one update command that mixes fork skills with other sources', () => {
    expect(() => buildAgentFeatureSkillUpdateArgs(['orca-cli', 'find-skills'])).toThrow(
      'Skills from the fork cannot share one update command with other skills.'
    )
  })

  it('re-points each skill into every agent home that holds it, one command per target set', () => {
    // Why: naming only `universal` leaves an independent copy in a provider home on
    // upstream bytes; naming that home's agent makes the CLI replace it with the fork's.
    expect(
      buildAgentFeatureSkillUpdateStepArgs(['orca-cli', 'orchestration', 'switch-account'], {
        global: true,
        yes: true,
        repointAgentsBySkill: {
          'orca-cli': ['claude-code', 'universal'],
          orchestration: ['universal'],
          'switch-account': ['claude-code', 'universal']
        }
      }).map((args) => args.join(' '))
    ).toEqual([
      'skills add https://github.com/ab2webco/orca-oss --skill orca-cli --skill switch-account --global --agent claude-code --agent universal -y',
      'skills add https://github.com/ab2webco/orca-oss --skill orchestration --global --agent universal -y'
    ])
  })

  it('splits a mixed update into the fork re-point first, then the update', () => {
    expect(
      buildAgentFeatureSkillUpdateStepArgs(['find-skills', 'orca-cli'], {
        global: true,
        yes: true
      })
    ).toEqual([
      [
        'skills',
        'add',
        'https://github.com/ab2webco/orca-oss',
        '--skill',
        'orca-cli',
        '--global',
        '--agent',
        'universal',
        '-y'
      ],
      ['skills', 'update', 'find-skills', '--global', '-y']
    ])
    expect(() => buildAgentFeatureSkillUpdateStepArgs([' '])).toThrow('A skill name is required.')
  })

  it('installs orca-plane from the lab fork, not the official Orca repo', () => {
    // orca-plane ships only in the fork, so its install URL must be the fork.
    expect(ORCA_PLANE_SKILL_INSTALL_COMMAND).toBe(
      'npx skills add https://github.com/ab2webco/orca-oss --skill orca-plane --global'
    )
  })

  it('installs and updates switch-account from the lab fork that owns the switch', () => {
    expect(SWITCH_ACCOUNT_SKILL_INSTALL_COMMAND).toBe(
      'npx skills add https://github.com/ab2webco/orca-oss --skill switch-account --global'
    )
    expect(SWITCH_ACCOUNT_SKILL_UPDATE_COMMAND).toBe(
      'npx skills add https://github.com/ab2webco/orca-oss --skill switch-account --global'
    )
  })

  it('installs and updates orca-game-scenes from the lab fork that ships the game', () => {
    expect(ORCA_GAME_SCENES_SKILL_INSTALL_COMMAND).toBe(
      'npx skills add https://github.com/ab2webco/orca-oss --skill orca-game-scenes --global'
    )
    expect(ORCA_GAME_SCENES_SKILL_UPDATE_COMMAND).toBe(
      'npx skills add https://github.com/ab2webco/orca-oss --skill orca-game-scenes --global'
    )
    expect(ORCA_GAME_SCENES_AGENT_SKILL_NAMES).toEqual(['orca-game-scenes'])
  })

  it('resolves every Orca-shipped skill name to the fork repository', () => {
    // Why: callers that build from a name they were handed (skill freshness,
    // the Windows reinstall fallback) never pass repositoryUrl of their own.
    for (const name of ORCA_SHIPPED_SKILL_NAMES) {
      expect(resolveAgentFeatureSkillRepositoryUrl(name)).toBe(
        'https://github.com/ab2webco/orca-oss'
      )
    }
    expect(buildAgentFeatureSkillInstallCommand(['orca-cli'])).toBe(
      'npx skills add https://github.com/ab2webco/orca-oss --skill orca-cli --global'
    )
  })

  it('keeps a mixed request of fork skills in one command against the fork', () => {
    expect(
      groupAgentFeatureSkillNamesByRepository(['switch-account', 'orca-cli', 'orca-plane'])
    ).toEqual([
      {
        repositoryUrl: 'https://github.com/ab2webco/orca-oss',
        skillNames: ['switch-account', 'orca-cli', 'orca-plane']
      }
    ])
    expect(
      buildAgentFeatureSkillInstallArgsByRepository(['orca-cli', 'switch-account'], {
        yes: true,
        agents: ['claude-code']
      }).map((args) => args.join(' '))
    ).toEqual([
      'skills add https://github.com/ab2webco/orca-oss --skill orca-cli --skill switch-account --global --agent claude-code -y'
    ])
  })

  it('rejects an empty request for the per-repository builder', () => {
    expect(() => buildAgentFeatureSkillInstallArgsByRepository([])).toThrow(
      'At least one skill name is required.'
    )
  })
})
