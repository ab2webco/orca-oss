import { useMemo } from 'react'
import { BatteryLow, ListChecks, RefreshCw, Users } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import {
  SWITCH_ACCOUNT_AGENT_SKILL_NAMES,
  SWITCH_ACCOUNT_SKILL_INSTALL_COMMAND,
  SWITCH_ACCOUNT_SKILL_NAME,
  SWITCH_ACCOUNT_SKILL_UPDATE_COMMAND
} from '@/lib/agent-feature-install-commands'
import {
  AGENT_SKILL_CLI_PREREQUISITE_NOTICE,
  ensureOrcaCliAvailableForAgentSkillTerminal
} from '@/lib/agent-skill-cli-prerequisite'
import { getAccountSwitchUsageExamples } from '@/lib/account-switch-usage-examples'
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
import { getAccountSwitchAgentSkillPaneSearchEntries } from './account-switch-agent-skill-search'
import { SearchableSetting } from './SearchableSetting'
import { SkillUsageExamplesSection } from './SkillUsageExamplesSection'
import { translate } from '@/i18n/i18n'
export { getAccountSwitchAgentSkillPaneSearchEntries } from './account-switch-agent-skill-search'

const ACCOUNT_SWITCH_EXAMPLE_ICONS: Record<string, LucideIcon> = {
  'list-accounts': ListChecks,
  'switch-now': RefreshCw,
  'out-of-quota': BatteryLow
}

function resolveAccountSwitchExampleIcon(example: SkillUsageExample): LucideIcon {
  return ACCOUNT_SWITCH_EXAMPLE_ICONS[example.id] ?? Users
}

// Why unconditional, unlike the Plane/Linear skill panes: this skill needs no
// provider connection. Any managed Claude terminal can switch accounts, so
// gating it behind an integration would hide it from everyone who needs it.
export function AccountSwitchAgentSkillPane(): React.JSX.Element {
  const activeSkillRuntime = useActiveProjectSkillRuntime()

  const {
    installed: skillInstalled,
    loading: skillLoading,
    error: skillError,
    refresh: refreshSkill
  } = useInstalledAgentSkillNames(SWITCH_ACCOUNT_AGENT_SKILL_NAMES, {
    discoveryTarget: activeSkillRuntime.discoveryTarget,
    sourceKinds: GLOBAL_AGENT_SKILL_SOURCE_KINDS
  })

  const installCommand = useMemo(
    () =>
      activeSkillRuntime.installDisabledReason
        ? SWITCH_ACCOUNT_SKILL_INSTALL_COMMAND
        : buildSkillCommandForRuntime(
            SWITCH_ACCOUNT_SKILL_INSTALL_COMMAND,
            activeSkillRuntime.agentRuntime
          ),
    [activeSkillRuntime.agentRuntime, activeSkillRuntime.installDisabledReason]
  )
  const updateCommand = useMemo(
    () =>
      activeSkillRuntime.installDisabledReason
        ? SWITCH_ACCOUNT_SKILL_UPDATE_COMMAND
        : buildSkillCommandForRuntime(
            SWITCH_ACCOUNT_SKILL_UPDATE_COMMAND,
            activeSkillRuntime.agentRuntime
          ),
    [activeSkillRuntime.agentRuntime, activeSkillRuntime.installDisabledReason]
  )

  return (
    <SearchableSetting
      title={translate(
        'auto.components.settings.AccountSwitchAgentSkillPane.title',
        'Account switching'
      )}
      description={translate(
        'auto.components.settings.AccountSwitchAgentSkillPane.description',
        'Let agents switch this terminal to another Claude account without losing the conversation.'
      )}
      keywords={getAccountSwitchAgentSkillPaneSearchEntries()[0].keywords}
      className="space-y-5 py-2"
    >
      <AgentSkillSetupPanel
        title={translate(
          'auto.components.settings.AccountSwitchAgentSkillPane.skillTitle',
          'Account switch skill'
        )}
        description={translate(
          'auto.components.settings.AccountSwitchAgentSkillPane.skillDescription',
          'Enables agents to list your Claude accounts and swap the one their terminal runs on, resuming the same session.'
        )}
        command={installCommand}
        installedCommand={updateCommand}
        terminalTitle={translate(
          'auto.components.settings.AccountSwitchAgentSkillPane.terminalTitle',
          'Account switch skill setup'
        )}
        terminalAriaLabel={translate(
          'auto.components.settings.AccountSwitchAgentSkillPane.terminalAriaLabel',
          'Account switch skill install terminal'
        )}
        terminalWorktreeId="settings-account-switch-skill-terminal"
        terminalShellOverride={activeSkillRuntime.terminalShellOverride}
        installed={skillInstalled}
        loading={skillLoading}
        error={activeSkillRuntime.installDisabledReason ?? skillError}
        installDisabled={Boolean(activeSkillRuntime.installDisabledReason)}
        icon={<Users className="size-5" />}
        preInstallNotice={AGENT_SKILL_CLI_PREREQUISITE_NOTICE}
        getPrerequisiteStatus={() =>
          activeSkillRuntime.agentRuntime?.runtime === 'wsl'
            ? window.api.cli.getWslInstallStatus(
                getWslCliDistroRequest(activeSkillRuntime.agentRuntime)
              )
            : window.api.cli.getInstallStatus()
        }
        onBeforeOpenTerminal={async () => {
          await (activeSkillRuntime.agentRuntime?.runtime === 'wsl'
            ? ensureWslCliAvailableForAgentSkillTerminal(activeSkillRuntime.agentRuntime)
            : ensureOrcaCliAvailableForAgentSkillTerminal())
        }}
        onRecheck={refreshSkill}
        // Why: the local-host-only freshness scan cannot vouch for a WSL runtime,
        // so fall back to the presence-only pill there (mirrors the other skills).
        freshnessSkillName={
          activeSkillRuntime.agentRuntime?.runtime === 'wsl' ? undefined : SWITCH_ACCOUNT_SKILL_NAME
        }
      />

      <SkillUsageExamplesSection
        heading={translate(
          'auto.components.settings.AccountSwitchAgentSkillPane.howToUse',
          'How to use it'
        )}
        description={translate(
          'auto.components.settings.AccountSwitchAgentSkillPane.howToUseDescription',
          'Ask the agent in a terminal to list your accounts, or to move that terminal to another one.'
        )}
        examples={getAccountSwitchUsageExamples()}
        resolveIcon={resolveAccountSwitchExampleIcon}
        slashCommand={`/${SWITCH_ACCOUNT_SKILL_NAME}`}
      />

      <p className="text-xs text-muted-foreground">
        {translate(
          'auto.components.settings.AccountSwitchAgentSkillPane.runtimeHint',
          'The switch runs in the terminal that asked for it: the account is swapped in place, the same session is resumed, and no tab or pane is created or lost. WSL and SSH terminals are not supported yet.'
        )}
      </p>
    </SearchableSetting>
  )
}
