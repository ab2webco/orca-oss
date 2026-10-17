import { Gamepad2, Palette, Sparkles, Wrench } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import {
  ORCA_GAME_SCENES_AGENT_SKILL_NAMES,
  ORCA_GAME_SCENES_SKILL_INSTALL_COMMAND,
  ORCA_GAME_SCENES_SKILL_NAME,
  ORCA_GAME_SCENES_SKILL_UPDATE_COMMAND
} from '@/lib/agent-feature-install-commands'
import {
  AGENT_SKILL_CLI_PREREQUISITE_NOTICE,
  ensureOrcaCliAvailableForAgentSkillTerminal
} from '@/lib/agent-skill-cli-prerequisite'
import { getOrcaGameScenesUsageExamples } from '@/lib/orca-game-scenes-usage-examples'
import type { SkillUsageExample } from '@/lib/skill-usage-example'
import {
  GLOBAL_AGENT_SKILL_SOURCE_KINDS,
  useInstalledAgentSkillNames
} from '@/hooks/useInstalledAgentSkills'
import { useActiveProjectSkillRuntime } from '@/hooks/useActiveProjectSkillRuntime'
import { AgentSkillSetupPanel } from './AgentSkillSetupPanel'
import {
  buildSkillCommandForRuntime,
  ensureWslCliAvailableForAgentSkillTerminal,
  getWslCliDistroRequest
} from './CliSkillRuntimeSetup'
import { getOrcaGameScenesSkillSearchEntries } from './orca-game-scenes-skill-search'
import { SearchableSetting } from './SearchableSetting'
import { SkillUsageExamplesSection } from './SkillUsageExamplesSection'
import { translate } from '@/i18n/i18n'

const SCENE_EXAMPLE_ICONS: Record<string, LucideIcon> = {
  'new-scene': Sparkles,
  'change-colors': Palette,
  'draws-quest': Wrench
}

function resolveSceneExampleIcon(example: SkillUsageExample): LucideIcon {
  return SCENE_EXAMPLE_ICONS[example.id] ?? Gamepad2
}

export function OrchestratorGameScenesSkillCard(): React.JSX.Element {
  const activeSkillRuntime = useActiveProjectSkillRuntime()
  const { installed, loading, error, refresh } = useInstalledAgentSkillNames(
    ORCA_GAME_SCENES_AGENT_SKILL_NAMES,
    {
      discoveryTarget: activeSkillRuntime.discoveryTarget,
      sourceKinds: GLOBAL_AGENT_SKILL_SOURCE_KINDS
    }
  )
  const isWsl = activeSkillRuntime.agentRuntime?.runtime === 'wsl'
  // Why not memoized on the runtime: the builder also reads the focused environment.
  const installCommand = activeSkillRuntime.installDisabledReason
    ? ORCA_GAME_SCENES_SKILL_INSTALL_COMMAND
    : buildSkillCommandForRuntime(
        ORCA_GAME_SCENES_SKILL_INSTALL_COMMAND,
        activeSkillRuntime.agentRuntime
      )
  const updateCommand = activeSkillRuntime.installDisabledReason
    ? ORCA_GAME_SCENES_SKILL_UPDATE_COMMAND
    : buildSkillCommandForRuntime(
        ORCA_GAME_SCENES_SKILL_UPDATE_COMMAND,
        activeSkillRuntime.agentRuntime
      )
  const [searchEntry] = getOrcaGameScenesSkillSearchEntries()

  return (
    <SearchableSetting
      title={searchEntry.title}
      description={searchEntry.description}
      keywords={searchEntry.keywords}
      className="space-y-5 pt-4"
      id="orca-game-scenes-skill"
    >
      <AgentSkillSetupPanel
        title={searchEntry.title}
        description={translate(
          'auto.components.settings.OrchestratorGameScenesSkillCard.description',
          'Lets agents make, restyle and fix custom scenes: they start from the template, validate the file until it is clean and turn it on for the project.'
        )}
        command={installCommand}
        installedCommand={updateCommand}
        terminalTitle={translate(
          'auto.components.settings.OrchestratorGameScenesSkillCard.terminalTitle',
          'Game scenes skill setup'
        )}
        terminalAriaLabel={translate(
          'auto.components.settings.OrchestratorGameScenesSkillCard.terminalAriaLabel',
          'Game scenes skill install terminal'
        )}
        terminalWorktreeId="settings-orca-game-scenes-skill-terminal"
        terminalShellOverride={activeSkillRuntime.terminalShellOverride}
        installed={installed}
        loading={loading}
        error={activeSkillRuntime.installDisabledReason ?? error}
        installDisabled={Boolean(activeSkillRuntime.installDisabledReason)}
        icon={<Gamepad2 className="size-5" />}
        preInstallNotice={AGENT_SKILL_CLI_PREREQUISITE_NOTICE}
        getPrerequisiteStatus={() =>
          isWsl && activeSkillRuntime.agentRuntime
            ? window.api.cli.getWslInstallStatus(
                getWslCliDistroRequest(activeSkillRuntime.agentRuntime)
              )
            : window.api.cli.getInstallStatus()
        }
        onBeforeOpenTerminal={async () => {
          await (isWsl && activeSkillRuntime.agentRuntime
            ? ensureWslCliAvailableForAgentSkillTerminal(activeSkillRuntime.agentRuntime)
            : ensureOrcaCliAvailableForAgentSkillTerminal())
        }}
        onRecheck={refresh}
        // Why: the local-host-only freshness scan cannot vouch for a WSL runtime.
        freshnessSkillName={isWsl ? undefined : ORCA_GAME_SCENES_SKILL_NAME}
      />

      <SkillUsageExamplesSection
        heading={translate(
          'auto.components.settings.OrchestratorGameScenesSkillCard.howToUse',
          'How to use it'
        )}
        description={translate(
          'auto.components.settings.OrchestratorGameScenesSkillCard.howToUseDescription',
          'Ask an agent in a terminal for a scene, a new look for the one you have, or why yours draws Quest.'
        )}
        examples={getOrcaGameScenesUsageExamples()}
        resolveIcon={resolveSceneExampleIcon}
        slashCommand={`/${ORCA_GAME_SCENES_SKILL_NAME}`}
      />
    </SearchableSetting>
  )
}
