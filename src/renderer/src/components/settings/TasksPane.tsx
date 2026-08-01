import { useEffect, useState } from 'react'
import { Github, Gitlab } from 'lucide-react'
import type { GlobalSettings, TaskProvider } from '../../../../shared/types'
import {
  TASK_PROVIDERS,
  normalizeVisibleTaskProviders,
  resolveVisibleTaskProvider
} from '../../../../shared/task-providers'
import { JiraIcon } from '@/components/icons/JiraIcon'
import { LinearIcon } from '@/components/icons/LinearIcon'
import { PlaneIcon } from '@/components/icons/PlaneIcon'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { useAppStore } from '@/store'
import { SearchableSetting } from './SearchableSetting'
import { SettingsSubsectionHeader } from './SettingsFormControls'
import { CodeHostSetupSteps, JiraSetupSteps } from './TaskSourceSimpleSetup'
import { TaskSourceLinearSetup } from './TaskSourceLinearSetup'
import { TaskSourceProviderCard } from './TaskSourceProviderCard'
import {
  getStalledVisibleTaskProviders,
  resolveStickyAutoExpandedTaskProvider
} from './task-source-setup-state'
import {
  JIRA_INTEGRATION_SECTION_ID,
  LINEAR_INTEGRATION_SECTION_ID
} from './task-provider-integration-section-ids'
import { getTasksPaneSearchKeywords } from './tasks-search'
import { useIntegrationProviderStatusRefresh } from './use-integration-provider-status-refresh'
import { useTaskSourceProviderReadiness } from './use-task-source-provider-readiness'
import { translate } from '@/i18n/i18n'

type TasksPaneProps = {
  settings: GlobalSettings
  updateSettings: (updates: Partial<GlobalSettings>) => void
}

const PROVIDER_META: Record<
  TaskProvider,
  {
    label: string
    description: string
    Icon: (props: { className?: string }) => React.JSX.Element
  }
> = {
  github: {
    get label() {
      return translate('auto.components.settings.TasksPane.e14063e727', 'GitHub')
    },
    get description() {
      return translate(
        'auto.components.settings.TasksPane.githubDescription',
        'Browse GitHub issues and start workspaces from them.'
      )
    },
    Icon: ({ className }) => <Github className={className} />
  },
  gitlab: {
    get label() {
      return translate('auto.components.settings.TasksPane.7c5d7fdc20', 'GitLab')
    },
    get description() {
      return translate(
        'auto.components.settings.TasksPane.gitlabDescription',
        'Browse GitLab issues and start workspaces from them.'
      )
    },
    Icon: ({ className }) => <Gitlab className={className} />
  },
  linear: {
    get label() {
      return translate('auto.components.settings.TasksPane.09ae2d7c51', 'Linear')
    },
    get description() {
      return translate(
        'auto.components.settings.TasksPane.linearDescription',
        'Connect Linear, install the agent skill, and show it in Tasks.'
      )
    },
    Icon: ({ className }) => <LinearIcon className={className} />
  },
  jira: {
    get label() {
      return translate('auto.components.settings.TasksPane.6b23a34f6d', 'Jira')
    },
    get description() {
      return translate(
        'auto.components.settings.TasksPane.jiraDescription',
        'Connect Jira Cloud or self-hosted Jira and show it in Tasks.'
      )
    },
    Icon: ({ className }) => <JiraIcon className={className} />
  },
  plane: {
    get label() {
      return translate('auto.components.settings.TasksPane.plane_label', 'Plane')
    },
    get description() {
      return translate(
        'auto.components.settings.TasksPane.plane_description',
        'Show Plane in the Tasks source picker and sidebar shortcuts.'
      )
    },
    Icon: ({ className }) => <PlaneIcon className={className} />
  }
}

export function TasksPane({ settings, updateSettings }: TasksPaneProps): React.JSX.Element {
  const visibleProviders = normalizeVisibleTaskProviders(settings.visibleTaskProviders)

  const [linearTemplateDraft, setLinearTemplateDraft] = useState(
    settings.linearLaunchPromptTemplate ?? ''
  )
  // Keep the draft in sync when the persisted value changes elsewhere.
  useEffect(() => {
    setLinearTemplateDraft(settings.linearLaunchPromptTemplate ?? '')
  }, [settings.linearLaunchPromptTemplate])

  const commitLinearTemplate = (): void => {
    if ((settings.linearLaunchPromptTemplate ?? '') === linearTemplateDraft) {
      return
    }
    updateSettings({ linearLaunchPromptTemplate: linearTemplateDraft })
  }

  const [planeTemplateDraft, setPlaneTemplateDraft] = useState(
    settings.planeLaunchPromptTemplate ?? ''
  )
  // Keep the draft in sync when the persisted value changes elsewhere.
  useEffect(() => {
    setPlaneTemplateDraft(settings.planeLaunchPromptTemplate ?? '')
  }, [settings.planeLaunchPromptTemplate])

  const commitPlaneTemplate = (): void => {
    if ((settings.planeLaunchPromptTemplate ?? '') === planeTemplateDraft) {
      return
    }
    updateSettings({ planeLaunchPromptTemplate: planeTemplateDraft })
  }

  const openSettingsPage = useAppStore((s) => s.openSettingsPage)
  const openSettingsTarget = useAppStore((s) => s.openSettingsTarget)
  const checkJiraConnection = useAppStore((s) => s.checkJiraConnection)
  const refreshPreflightStatus = useAppStore((s) => s.refreshPreflightStatus)
  const readinessByProvider = useTaskSourceProviderReadiness(visibleProviders)
  useIntegrationProviderStatusRefresh()

  // Warn only about started-then-stalled setup; untouched providers are the default.
  const stalledVisible = getStalledVisibleTaskProviders(TASK_PROVIDERS, readinessByProvider)
  // Sticky across rechecks so expanded Linear install terminals are not unmounted.
  // Claim during render (not an effect): a layout effect elsewhere can force a
  // sync re-render before passive effects flush and collapse the open card.
  // useState (not a ref write) keeps render pure for React Doctor.
  const [previousAutoExpanded, setPreviousAutoExpanded] = useState<TaskProvider | null>(null)
  const autoExpandedProvider = resolveStickyAutoExpandedTaskProvider({
    providers: TASK_PROVIDERS,
    readinessByProvider,
    previousAutoExpanded
  })
  if (autoExpandedProvider !== null && previousAutoExpanded === null) {
    setPreviousAutoExpanded(autoExpandedProvider)
  }

  const toggleProvider = (provider: TaskProvider): void => {
    const isVisible = visibleProviders.includes(provider)
    if (isVisible && visibleProviders.length === 1) {
      return
    }

    const nextProviders = isVisible
      ? visibleProviders.filter((entry) => entry !== provider)
      : TASK_PROVIDERS.filter((entry) => entry === provider || visibleProviders.includes(entry))

    updateSettings({
      visibleTaskProviders: nextProviders,
      defaultTaskSource: resolveVisibleTaskProvider(settings.defaultTaskSource, nextProviders)
    })
  }

  const openIntegrations = (sectionId?: string): void => {
    openSettingsPage()
    openSettingsTarget({
      pane: 'integrations',
      repoId: null,
      ...(sectionId ? { sectionId } : {})
    })
  }

  return (
    <div className="space-y-6">
      <section className="space-y-3">
        <SettingsSubsectionHeader
          title={translate(
            'auto.components.settings.TasksPane.setupTitle',
            'Task management setup'
          )}
          description={translate(
            'auto.components.settings.TasksPane.setupDescription',
            'Finish connect + visibility for each provider in one place. Linear also needs the agent skill so coding agents can read and update tickets. At least one provider must stay visible.'
          )}
        />

        {stalledVisible.length > 0 ? (
          <div className="rounded-xl border border-amber-500/25 bg-amber-500/5 px-3.5 py-3 text-xs text-muted-foreground">
            <p className="font-medium text-amber-800 dark:text-amber-200">
              {translate(
                'auto.components.settings.TasksPane.incompleteBannerTitle',
                'Some visible providers still need setup'
              )}
            </p>
            {/* Linear is the only multi-step provider today; the generic body
                covers any future provider that can stall the same way. */}
            <p className="mt-1">
              {stalledVisible.includes('linear')
                ? translate(
                    'auto.components.settings.TasksPane.incompleteBannerBodyWithLinear',
                    'Hide providers you do not use, or expand a card and finish its steps. For Linear: API access, the agent skill, and Show in Tasks.'
                  )
                : translate(
                    'auto.components.settings.TasksPane.incompleteBannerBody',
                    'Hide providers you do not use, or expand a card and finish its steps.'
                  )}
            </p>
          </div>
        ) : null}

        <SearchableSetting
          title={translate('auto.components.settings.TasksPane.f71d8a9dd3', 'Task Providers')}
          description={translate(
            'auto.components.settings.TasksPane.providersDescription',
            'Each card walks through connection (and skill, for Linear) plus whether it appears in Tasks.'
          )}
          keywords={getTasksPaneSearchKeywords()}
          className="space-y-3 py-2"
        >
          {TASK_PROVIDERS.map((provider) => {
            const meta = PROVIDER_META[provider]
            const readiness = readinessByProvider[provider]
            const Icon = meta.Icon
            const visible = readiness.visible
            const canHide = visibleProviders.length > 1

            return (
              <TaskSourceProviderCard
                key={provider}
                icon={<Icon className="size-4" />}
                name={meta.label}
                description={meta.description}
                readiness={readiness}
                visible={visible}
                canHide={canHide}
                defaultExpanded={autoExpandedProvider === provider}
                onToggleVisible={() => toggleProvider(provider)}
              >
                {provider === 'linear' ? (
                  <TaskSourceLinearSetup
                    connected={readiness.connected}
                    checking={readiness.checking}
                    visible={visible}
                    canHide={canHide}
                    onToggleVisible={() => toggleProvider('linear')}
                    onOpenIntegrations={() => openIntegrations(LINEAR_INTEGRATION_SECTION_ID)}
                  />
                ) : provider === 'jira' ? (
                  <JiraSetupSteps
                    connected={readiness.connected}
                    checking={readiness.checking}
                    visible={visible}
                    canHide={canHide}
                    onToggleVisible={() => toggleProvider('jira')}
                    onConnected={() => void checkJiraConnection()}
                    onOpenIntegrations={() => openIntegrations(JIRA_INTEGRATION_SECTION_ID)}
                  />
                ) : (
                  <CodeHostSetupSteps
                    providerLabel={meta.label}
                    connected={readiness.connected}
                    checking={readiness.checking}
                    unavailable={readiness.unavailable}
                    visible={visible}
                    canHide={canHide}
                    onToggleVisible={() => toggleProvider(provider)}
                    onOpenIntegrations={() => openIntegrations()}
                    onRetryConnection={() => void refreshPreflightStatus({ force: true })}
                  />
                )}
              </TaskSourceProviderCard>
            )
          })}
        </SearchableSetting>

        <p className="text-xs text-muted-foreground">
          {translate(
            'auto.components.settings.TasksPane.integrationsHint',
            'Credentials for all providers also live under'
          )}{' '}
          <Button
            type="button"
            variant="link"
            size="sm"
            className="h-auto p-0 text-xs align-baseline"
            onClick={() => openIntegrations()}
          >
            {translate('auto.components.settings.TasksPane.integrationsLink', 'Integrations')}
          </Button>
          {translate(
            'auto.components.settings.TasksPane.skillHint',
            '. After Linear is connected, usage examples stay under Settings → Linear.'
          )}
        </p>
      </section>

      <section className="space-y-3">
        <SettingsSubsectionHeader
          title={translate('auto.components.settings.TasksPane.09ae2d7c51', 'Linear')}
          description={translate(
            'auto.components.settings.TasksPane.cbcd4247a4',
            'Customize the first instruction Orca sends to the agent when you start a worktree from a Linear issue.'
          )}
        />
        <SearchableSetting
          title={translate(
            'auto.components.settings.TasksPane.8490b38b7e',
            'Launch prompt template'
          )}
          description={translate(
            'auto.components.settings.TasksPane.6a0d7e542a',
            'Leave empty to use the default. The issue identifier and URL variables are shown in the field placeholder.'
          )}
          keywords={['linear', 'prompt', 'template', 'launch', 'instruction', 'identifier', 'url']}
          className="space-y-2 py-2"
        >
          <textarea
            aria-label={translate(
              'auto.components.settings.TasksPane.linear_launch_prompt_aria',
              'Linear launch prompt template'
            )}
            value={linearTemplateDraft}
            rows={3}
            spellCheck={false}
            placeholder={translate(
              'auto.components.settings.TasksPane.f37954bf8a',
              'Linked Linear issue: {{identifier}}\n{{url}}',
              { identifier: '{{identifier}}', url: '{{url}}' }
            )}
            onChange={(event) => setLinearTemplateDraft(event.target.value)}
            onBlur={commitLinearTemplate}
            className="w-full resize-y rounded-md border border-border bg-background px-2.5 py-2 font-mono text-xs text-foreground outline-none placeholder:text-muted-foreground/70 focus-visible:ring-1 focus-visible:ring-ring"
          />
        </SearchableSetting>
      </section>

      <section className="space-y-3">
        <SettingsSubsectionHeader
          title={translate('auto.components.settings.TasksPane.plane_section_title', 'Plane')}
          description={translate(
            'auto.components.settings.TasksPane.plane_section_description',
            'Customize the first instruction Orca sends to the agent when you start a worktree from a Plane work item.'
          )}
        />
        <SearchableSetting
          title={translate(
            'auto.components.settings.TasksPane.plane_launch_prompt_title',
            'Launch prompt template'
          )}
          description={translate(
            'auto.components.settings.TasksPane.plane_launch_prompt_description',
            'Leave empty to use the default. The work item identifier and URL variables are shown in the field placeholder.'
          )}
          keywords={['plane', 'prompt', 'template', 'launch', 'instruction', 'identifier', 'url']}
          className="space-y-2 py-2"
        >
          <textarea
            aria-label={translate(
              'auto.components.settings.TasksPane.plane_launch_prompt_aria',
              'Plane launch prompt template'
            )}
            value={planeTemplateDraft}
            rows={3}
            spellCheck={false}
            placeholder={translate(
              'auto.components.settings.TasksPane.plane_launch_prompt_placeholder',
              'Linked Plane work item: {{identifier}}\n{{url}}',
              { identifier: '{{identifier}}', url: '{{url}}' }
            )}
            onChange={(event) => setPlaneTemplateDraft(event.target.value)}
            onBlur={commitPlaneTemplate}
            className="w-full resize-y rounded-md border border-border bg-background px-2.5 py-2 font-mono text-xs text-foreground outline-none placeholder:text-muted-foreground/70 focus-visible:ring-1 focus-visible:ring-ring"
          />
        </SearchableSetting>
        <SearchableSetting
          title={translate(
            'auto.components.settings.TasksPane.plane_strip_attribution_title',
            'Hide AI attribution on work items'
          )}
          description={translate(
            'auto.components.settings.TasksPane.plane_strip_attribution_description',
            'Remove agent-authored provenance footers (e.g. "Planned with Claude Code", "Refined with Codex") from descriptions and comments before they are written to Plane.'
          )}
          keywords={[
            'plane',
            'ai',
            'attribution',
            'provenance',
            'claude',
            'codex',
            'footer',
            'signature',
            'ticket'
          ]}
          className="py-2"
        >
          <label className="flex items-center gap-2 text-sm text-foreground">
            <Checkbox
              checked={settings.stripAiAttributionFromTickets !== false}
              onCheckedChange={(value) =>
                updateSettings({ stripAiAttributionFromTickets: value === true })
              }
            />
            {translate(
              'auto.components.settings.TasksPane.plane_strip_attribution_toggle',
              'Strip AI attribution before writing'
            )}
          </label>
        </SearchableSetting>
      </section>
    </div>
  )
}
