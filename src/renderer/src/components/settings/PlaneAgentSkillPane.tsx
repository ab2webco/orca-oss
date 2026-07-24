import { useMemo } from 'react'
import { ArrowRightCircle, BookOpen, ListTodo, MessageSquarePlus } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { PlaneIcon } from '@/components/icons/PlaneIcon'
import { Button } from '@/components/ui/button'
import { useAppStore } from '@/store'
import {
  ORCA_PLANE_SKILL_INSTALL_COMMAND,
  ORCA_PLANE_SKILL_NAME,
  ORCA_PLANE_SKILL_UPDATE_COMMAND,
  PLANE_AGENT_SKILL_NAMES
} from '@/lib/agent-feature-install-commands'
import {
  AGENT_SKILL_CLI_PREREQUISITE_NOTICE,
  ensureOrcaCliAvailableForAgentSkillTerminal
} from '@/lib/agent-skill-cli-prerequisite'
import { getPlaneUsageExamples } from '@/lib/plane-usage-examples'
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
import { getPlaneAgentSkillPaneSearchEntries } from './plane-agent-skill-search'
import { SearchableSetting } from './SearchableSetting'
import { SkillUsageExamplesSection } from './SkillUsageExamplesSection'
import { translate } from '@/i18n/i18n'
export { getPlaneAgentSkillPaneSearchEntries } from './plane-agent-skill-search'

const PLANE_EXAMPLE_ICONS: Record<string, LucideIcon> = {
  'read-work-item': BookOpen,
  'post-update': MessageSquarePlus,
  'move-state': ArrowRightCircle,
  triage: ListTodo
}

function resolvePlaneExampleIcon(example: SkillUsageExample): LucideIcon {
  return PLANE_EXAMPLE_ICONS[example.id] ?? BookOpen
}

// Why: this section is rendered as a Settings section only when the Plane
// provider is connected, so the orca-plane agent skill sits beside the
// connection that makes it useful.
export function PlaneAgentSkillPane(): React.JSX.Element {
  const activeSkillRuntime = useActiveProjectSkillRuntime()
  const openSettingsPage = useAppStore((state) => state.openSettingsPage)
  const openSettingsTarget = useAppStore((state) => state.openSettingsTarget)

  const openIntegrationSettings = (): void => {
    openSettingsPage()
    openSettingsTarget({ pane: 'integrations', repoId: null })
  }

  const {
    installed: planeSkillInstalled,
    loading: planeSkillLoading,
    error: planeSkillError,
    refresh: refreshPlaneSkill
  } = useInstalledAgentSkillNames(PLANE_AGENT_SKILL_NAMES, {
    discoveryTarget: activeSkillRuntime.discoveryTarget,
    sourceKinds: GLOBAL_AGENT_SKILL_SOURCE_KINDS
  })

  const installCommand = useMemo(
    () =>
      activeSkillRuntime.installDisabledReason
        ? ORCA_PLANE_SKILL_INSTALL_COMMAND
        : buildSkillCommandForRuntime(
            ORCA_PLANE_SKILL_INSTALL_COMMAND,
            activeSkillRuntime.agentRuntime
          ),
    [activeSkillRuntime.agentRuntime, activeSkillRuntime.installDisabledReason]
  )
  const updateCommand = useMemo(
    () =>
      activeSkillRuntime.installDisabledReason
        ? ORCA_PLANE_SKILL_UPDATE_COMMAND
        : buildSkillCommandForRuntime(
            ORCA_PLANE_SKILL_UPDATE_COMMAND,
            activeSkillRuntime.agentRuntime
          ),
    [activeSkillRuntime.agentRuntime, activeSkillRuntime.installDisabledReason]
  )

  return (
    <SearchableSetting
      title={translate('auto.components.settings.PlaneAgentSkillPane.title', 'Plane')}
      description={translate(
        'auto.components.settings.PlaneAgentSkillPane.description',
        'Give agents the skill to read and update your Plane work items.'
      )}
      keywords={getPlaneAgentSkillPaneSearchEntries()[0].keywords}
      className="space-y-5 py-2"
    >
      <AgentSkillSetupPanel
        title={translate('auto.components.settings.PlaneAgentSkillPane.skillTitle', 'Plane skill')}
        description={translate(
          'auto.components.settings.PlaneAgentSkillPane.skillDescription',
          'Enables agents to read work items and post updates to Plane through Orca.'
        )}
        command={installCommand}
        installedCommand={updateCommand}
        terminalTitle={translate(
          'auto.components.settings.PlaneAgentSkillPane.terminalTitle',
          'Plane skill setup'
        )}
        terminalAriaLabel={translate(
          'auto.components.settings.PlaneAgentSkillPane.terminalAriaLabel',
          'Plane skill install terminal'
        )}
        terminalWorktreeId="settings-plane-skill-terminal"
        terminalShellOverride={activeSkillRuntime.terminalShellOverride}
        installed={planeSkillInstalled}
        loading={planeSkillLoading}
        error={activeSkillRuntime.installDisabledReason ?? planeSkillError}
        installDisabled={Boolean(activeSkillRuntime.installDisabledReason)}
        icon={<PlaneIcon className="size-5" />}
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
        onRecheck={refreshPlaneSkill}
        // Why: the local-host-only freshness scan cannot vouch for a WSL runtime,
        // so fall back to the presence-only pill there (mirrors the other skills).
        freshnessSkillName={
          activeSkillRuntime.agentRuntime?.runtime === 'wsl' ? undefined : ORCA_PLANE_SKILL_NAME
        }
      />

      <SkillUsageExamplesSection
        heading={translate(
          'auto.components.settings.PlaneAgentSkillPane.howToUse',
          'How to use it'
        )}
        description={translate(
          'auto.components.settings.PlaneAgentSkillPane.howToUseDescription',
          'Ask an agent working a Plane task to read context, post updates, or move the work item.'
        )}
        examples={getPlaneUsageExamples()}
        resolveIcon={resolvePlaneExampleIcon}
        slashCommand={`/${ORCA_PLANE_SKILL_NAME}`}
      />

      <p className="text-xs text-muted-foreground">
        {translate(
          'auto.components.settings.PlaneAgentSkillPane.manageConnectionHint',
          'Review connected Plane workspaces and API keys in'
        )}{' '}
        <Button
          type="button"
          variant="link"
          size="sm"
          className="h-auto p-0 text-xs align-baseline"
          onClick={openIntegrationSettings}
        >
          {translate(
            'auto.components.settings.PlaneAgentSkillPane.manageConnectionLink',
            'Integrations settings'
          )}
        </Button>
      </p>
    </SearchableSetting>
  )
}
