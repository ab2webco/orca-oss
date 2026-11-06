import { useEffect, useRef } from 'react'
import { Settings2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { translate } from '@/i18n/i18n'
import type { TeamPanelModel, TeamTabId } from '../../../../shared/team-panel-model-types'
import type { TeamPanelResolvedTab } from './team-panel-tab-definition'
import { pickTeamPanelTab, resolveTeamPanelTabs } from './team-panel-tab-registry'
import { tabStripScrollLeftFor } from './team-panel-tab-strip'
import { useTeamPanelTabStore } from './team-panel-tab-store'
import {
  TeamPanelLoadingState,
  TeamPanelMessageState,
  TeamPanelUnavailableState
} from './team-panel-section-state'
import type { TeamPanelModelSource } from './use-team-panel-model'
import type { TeamPanelLook } from './use-team-panel-look'
import { TeamPanelScene } from '../team-scene/TeamPanelScene'
import { useTeamSceneStyle } from '../team-scene/use-team-scene-style'

/** With a team the gear opens the project; without one, the global Panel settings. */
export function teamPanelSettingsRepoId(model: TeamPanelModel | null): string | null {
  return model?.kind === 'team' ? model.repoId : null
}

function TeamPanelHeader({
  model,
  onOpenSettings
}: {
  model: TeamPanelModel | null
  onOpenSettings: (repoId: string | null) => void
}): React.JSX.Element {
  const title =
    model?.kind === 'team'
      ? model.projectName
      : model?.kind === 'solo'
        ? translate('teamPanel.header.noTeamTitle', 'Your work')
        : translate('teamPanel.header.title', 'Team')
  const gearLabel =
    model?.kind === 'team'
      ? translate('teamPanel.header.projectSettings', 'Project settings')
      : translate('teamPanel.header.panelSettings', 'Panel settings')
  return (
    <div className="flex h-11 min-h-11 items-center gap-2 pl-3 pr-1.5">
      <h2 className="min-w-0 flex-1 truncate text-[13px] font-semibold text-foreground">{title}</h2>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon-xs"
            className="text-muted-foreground"
            aria-label={gearLabel}
            onClick={() => onOpenSettings(teamPanelSettingsRepoId(model))}
          >
            <Settings2 />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="bottom" sideOffset={6}>
          {gearLabel}
        </TooltipContent>
      </Tooltip>
    </div>
  )
}

function TeamPanelTabBody({
  tab,
  selectTab
}: {
  tab: TeamPanelResolvedTab
  selectTab: (tab: TeamTabId) => void
}): React.JSX.Element {
  const { view, copy } = tab
  switch (view.kind) {
    case 'loading':
      return <TeamPanelLoadingState rows={4} />
    case 'unavailable':
      return copy.unavailable ? (
        <TeamPanelMessageState title={copy.unavailable.title} text={copy.unavailable.text} />
      ) : (
        <TeamPanelUnavailableState title={copy.errorTitle} />
      )
    case 'error':
      return <TeamPanelMessageState title={copy.errorTitle} text={view.message} tone="error" />
    case 'empty':
      return <TeamPanelMessageState title={copy.emptyTitle} text={copy.emptyText} />
    case 'ready':
      return <>{view.render(selectTab)}</>
  }
}

function TeamPanelTabs({ model }: { model: TeamPanelModel }): React.JSX.Element | null {
  const selected = useTeamPanelTabStore((s) => s.selected)
  const select = useTeamPanelTabStore((s) => s.select)
  const tabs = resolveTeamPanelTabs(model)
  const active = pickTeamPanelTab(tabs, selected)
  const activeTrigger = useRef<HTMLButtonElement>(null)
  const activeId = active?.id
  // Why: a narrower window clips the selected tab too, so reveal on resize as well as on select.
  // Not scrollIntoView, which would also move the shell's hidden-overflow ancestors.
  useEffect(() => {
    const strip = activeTrigger.current?.parentElement
    if (!strip) {
      return
    }
    const reveal = (): void => {
      const trigger = activeTrigger.current
      if (trigger) {
        strip.scrollLeft = tabStripScrollLeftFor(
          strip.getBoundingClientRect(),
          trigger.getBoundingClientRect(),
          strip.scrollLeft
        )
      }
    }
    reveal()
    const observer = new ResizeObserver(reveal)
    observer.observe(strip)
    return () => observer.disconnect()
  }, [activeId])
  if (!active) {
    return null
  }
  return (
    <Tabs
      value={active.id}
      onValueChange={(value) => select(value as TeamTabId)}
      className="flex min-h-0 flex-1 flex-col gap-0"
    >
      <TabsList
        variant="line"
        aria-label={translate('teamPanel.tabs.label', 'Panel sections')}
        className="h-[35px] w-full shrink-0 justify-start gap-4 overflow-x-auto border-b border-border px-3 [scrollbar-width:none]"
      >
        {tabs.map((tab) => (
          <TabsTrigger
            key={tab.id}
            ref={tab.id === active.id ? activeTrigger : undefined}
            value={tab.id}
            className="h-full flex-none rounded-none px-0 text-[13px] after:bottom-[-1px]"
          >
            {tab.title}
            {tab.count !== null ? (
              <span className="inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive/15 px-1 text-[11px] font-semibold tabular-nums text-destructive">
                {tab.count}
              </span>
            ) : null}
          </TabsTrigger>
        ))}
      </TabsList>
      {/* Why: the floating trigger covers this corner; the last row must scroll clear of it. */}
      <TabsContent
        value={active.id}
        className="min-h-0 flex-1 overflow-y-auto pb-24 scrollbar-sleek"
      >
        <TeamPanelTabBody tab={active} selectTab={select} />
      </TabsContent>
    </Tabs>
  )
}

export function TeamPanelView({
  source,
  look,
  onOpenSettings
}: {
  source: TeamPanelModelSource
  look: TeamPanelLook
  onOpenSettings: (repoId: string | null) => void
}): React.JSX.Element {
  const { section, retry } = source
  const sceneStyle = useTeamSceneStyle()
  const model = section.kind === 'ready' ? section.value : null
  const body = (
    <>
      <TeamPanelHeader model={model} onOpenSettings={onOpenSettings} />
      {section.kind === 'ready' ? (
        <TeamPanelTabs model={section.value} />
      ) : section.kind === 'loading' ? (
        <TeamPanelLoadingState rows={5} />
      ) : section.kind === 'error' ? (
        <TeamPanelMessageState
          title={translate('teamPanel.state.modelErrorTitle', 'Could not read the team')}
          text={section.message}
          tone="error"
          action={
            retry
              ? {
                  label: translate('teamPanel.state.retry', 'Try again'),
                  onClick: retry
                }
              : null
          }
        />
      ) : (
        <TeamPanelUnavailableState
          title={translate('teamPanel.state.modelUnavailableTitle', 'Team data is not available')}
        />
      )}
    </>
  )
  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="team-panel">
      {model?.kind === 'team' && look === 'game' ? (
        <TeamPanelScene model={model} style={sceneStyle}>
          {body}
        </TeamPanelScene>
      ) : (
        body
      )}
    </div>
  )
}
