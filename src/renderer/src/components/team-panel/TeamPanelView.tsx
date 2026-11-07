import { useEffect } from 'react'
import { Settings2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { translate } from '@/i18n/i18n'
import type { TeamPanelModel, TeamTabId } from '../../../../shared/team-panel-model-types'
import { TeamReadError, TeamReadNotice, TeamReadRetryContext } from './team-panel-read-error'
import { TeamSessionCount } from './team-panel-session-count'
import type { TeamPanelResolvedTab } from './team-panel-tab-definition'
import { pickTeamPanelTab, resolveTeamPanelTabs } from './team-panel-tab-registry'
import { TabStripEdgeCues, useTabStripCue } from './team-panel-tab-strip-cue'
import { useTeamPanelTabStore } from './team-panel-tab-store'
import {
  TeamPanelLoadingState,
  TeamPanelMessageState,
  TeamPanelUnavailableState
} from './team-panel-section-state'
import type { TeamPanelModelSource } from './use-team-panel-model'
import type { TeamPanelLook } from './use-team-panel-look'
import { TeamXpRow } from './TeamXpRow'
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
  const publishShown = useTeamPanelTabStore((s) => s.publishShown)
  const tabs = resolveTeamPanelTabs(model)
  const active = pickTeamPanelTab(tabs, selected)
  const shownId = active?.id ?? null
  useEffect(() => publishShown(shownId), [publishShown, shownId])
  const { activeTrigger, overflow, stripProps } = useTabStripCue(
    active?.id,
    tabs.map((tab) => tab.id).join()
  )
  if (!active) {
    return null
  }
  return (
    <Tabs
      value={active.id}
      onValueChange={(value) => select(value as TeamTabId)}
      className="flex min-h-0 flex-1 flex-col gap-0"
    >
      {/* Why a container query: under 340 px, V28's narrow spacing and 12 px text fit five tabs at 280. */}
      <div className="@container relative shrink-0">
        <TabsList
          variant="line"
          aria-label={translate('teamPanel.tabs.label', 'Panel sections')}
          {...stripProps}
          className="h-[35px] w-full shrink-0 justify-start gap-2.5 overflow-x-auto border-b border-border px-2 [scrollbar-width:none] @[340px]:gap-4 @[340px]:px-3"
        >
          {tabs.map((tab) => (
            <TabsTrigger
              key={tab.id}
              ref={tab.id === active.id ? activeTrigger : undefined}
              value={tab.id}
              className="h-full flex-none gap-1 rounded-none px-0 text-[12px] after:bottom-[-1px] @[340px]:gap-1.5 @[340px]:text-[13px]"
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
        <TabStripEdgeCues overflow={overflow} />
      </div>
      {/* Why: the floating trigger covers this corner; the last row must scroll clear of it. */}
      <TabsContent
        value={active.id}
        className="min-h-0 flex-1 overflow-y-auto pb-24 scrollbar-sleek"
      >
        {/* Why not Team: V28 draws it under the lead, and that tab places it there. */}
        {active.id === 'team' ? null : <TeamReadNotice />}
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
      {model?.kind === 'team' && look === 'game' && model.xp ? <TeamXpRow xp={model.xp} /> : null}
      {model?.kind === 'solo' ? <TeamSessionCount rows={model.rows} /> : null}
      {section.kind === 'ready' ? (
        <TeamReadRetryContext.Provider value={retry}>
          <TeamPanelTabs model={section.value} />
        </TeamReadRetryContext.Provider>
      ) : section.kind === 'loading' ? (
        <TeamPanelLoadingState rows={5} />
      ) : section.kind === 'error' ? (
        <TeamReadError retry={retry} />
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
