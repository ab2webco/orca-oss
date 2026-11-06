import type { EngineInterface, On, RenderElement } from 'claude-code'

import type { GameAgent } from '../types'
import { advisorCard, advisorCardViewOf } from './advisor-card'
import { advisorPinsOf, ownAdvisorOf } from './advisor-report'
import { advisorNow } from './advisor-state'
import { ADVISOR_TILE_KEY } from './advisor-tile'
import { flatLine } from './flat-block'
import { flatPaneMembers } from './flat-rows'
import { isFlatMode } from './flat-toggle'
import { paneMenuItemsOf } from './pane-menu'
import { flatScoreLineOf } from './flat-view'
import { memberHeadingOf } from './fleet-labels'
import { memberCard } from './fleet-member-card'
import { HUD_ROWS, hudCellsOf } from './fleet-hud'
import { projectRowsOf } from './fleet-project'
import { reviewSectionOf } from './fleet-review-section'
import { viewLabelOf, viewMember } from './member-view-press'
import { openGameLink, viewOf } from './fleet-sync'
import { cardLayoutOf, TILE_COLUMNS, TILE_ROWS, tileCellsOf } from './fleet-tiles'
import { leadTitleOf } from './game-lead'
import { cardStateOf, leadStateOf } from './lead-state'
import { runAction } from './game-actions'
import { gameLinkOf } from './game-link'
import { gameStrings } from './game-strings'
import { countsOf, drawnPartyOf, memberOf, needsOf, teamOrderOf } from './party'
import { animate } from './quest'
import {
  currentScene,
  gameConfig,
  isSceneShown,
  ready,
  shownHero,
  shownLead
} from './quest-runtime'
import { paneLinksOf, type PaneLink } from './pane-links'
import { projectKeyOf, type PanelSection } from './panel-layout'
import { hintLayoutOnce, readFleetLayout } from './panel-layout-store'
import { needCalloutsOf, statusPartsOf, type StatusKey } from './panel-heading'
import { sectionChipsOf, sectionMarksOf } from './panel-section-marks'
import { catalogPickerOf } from './panel-widgets'
import { levelOf } from './rewards'
import { fleetAdvisorSummaryOf, memberModelLinesOf, memberModelOf } from './member-advisor'
import { tapButtonsOf, type TapButton } from './tap-buttons'
import { cellWidthOf } from './cell-width'
import { viewPickerOf } from './view-picker'
import { isTapLayout } from './tap-layout'
import { paneMenuRowOf } from './pane-menu-row'
import { hostCapacityTextsOf } from './fleet-host-rows'

export const PANE_ID = 'orca-game-fleet'
const STATUS_COLORS: Readonly<Record<StatusKey, string>> = {
  working: 'cyan',
  idle: 'gray',
  done: 'green',
  waiting: 'red'
}
const HUD_KEY = 'pane-hud'

export async function openPane($: EngineInterface): Promise<void> {
  const title = gameStrings().text.fleet
  await $.ui.open({ id: PANE_ID, title, closeOnEscape: true, focus: true })
  await hintLayoutOnce($).catch(() => undefined)
}

/** True while the Panel is placed and is the tab its surface shows. */
export async function isPaneShown($: EngineInterface): Promise<boolean> {
  const panes = await $.ui.panes().catch(() => [])
  return panes.some((one) => one.id === PANE_ID && one.isShown && one.isPlaced)
}

export const registerFleetPane = (on: On): void => {
  on('ui.render', { component: 'Pane', requestId: PANE_ID }, async ($, e) => {
    await ready($)
    const v = await viewOf($)
    const config = gameConfig()
    const scene = currentScene()
    const palette = scene.band
    const { Box, Text, Button } = $.ui.resolve(e)
    const text = gameStrings().text
    const close = () => void $.ui.close({ id: PANE_ID }).catch(() => undefined)
    const columns = Math.max(1, Math.min(512, e.props.bodyColumns))
    const isTap = isTapLayout(columns)
    const cardLayout = cardLayoutOf(columns)
    const cardRoom = cardLayout.room
    const tapOf = (one: Omit<TapButton, 'color' | 'backgroundColor'>): TapButton => ({
      ...one,
      color: palette.parchment,
      backgroundColor: palette.panel
    })
    // Digits follow tile order; r p q are the menu's, i o c w a g t the links'; actions take the rest.
    const viewPressOf = (agent: GameAgent, handle: string) => () => viewMember($, agent, handle)
    const viewHotkeyOf = (index: number) => (index < 9 ? String(index + 1) : undefined)
    const view = (agent: GameAgent, handle: string, index: number) => (
      <Button
        key={`view-${agent.paneKey}`}
        plain
        hotkey={viewHotkeyOf(index)}
        onPress={viewPressOf(agent, handle)}
      >
        <Text backgroundColor={palette.panel} color={palette.parchment} bold>
          {` ${viewLabelOf(agent)} `}
        </Text>
      </Button>
    )
    // On a phone View is a touch chip inside the card, beside the review and ticket chips.
    const tapView = (agent: GameAgent, handle: string, index: number) =>
      tapButtonsOf(
        $,
        e,
        `view-tap-${agent.paneKey}`,
        [
          {
            ...tapOf({
              key: `view-${agent.paneKey}`,
              labels: [`▸ ${viewLabelOf(agent)}`],
              hotkey: viewHotkeyOf(index),
              onPress: viewPressOf(agent, handle)
            }),
            bold: true
          }
        ],
        columns
      )
    const isFlat = isFlatMode()
    const menuItems = paneMenuItemsOf($, scene, isFlat, close)
    const picker = await viewPickerOf($, e, palette, columns)
    const menuRow = paneMenuRowOf($, e, palette, columns, menuItems, picker)
    const isLead = v.state?.role === 'lead'
    const cardMembers = (v.state?.agents ?? [])
      .filter((agent) => agent.isMember === true)
      .map((agent) => ({
        key: agent.paneKey,
        name: memberHeadingOf(agent).name,
        model: memberModelOf(agent),
        isJev: Boolean(agent.advisor?.model)
      }))
    const advisorView = await advisorCardViewOf($, { isLead, members: cardMembers })
    const ownJev = isLead ? advisorNow() : null
    const ownAdvisor = ownJev === null ? undefined : ownAdvisorOf(ownJev, await advisorPinsOf($))
    const advisorTiles = advisorView === null || !cardLayout.withTile ? [] : [advisorView.tile]
    const advisorOf = (art: Map<string, RenderElement>) =>
      advisorView === null
        ? null
        : advisorCard(
            $,
            e,
            palette,
            advisorView.card,
            art.get(ADVISOR_TILE_KEY),
            !isFlat && cardLayout.withTile
          )
    if (v.state === null) {
      return (
        <Box flexDirection="column">
          <Text dimColor>{`${text.fleet} · ${v.note === '' ? text.loading : v.note}`}</Text>
          {advisorOf(await animate($, e, advisorTiles))}
          {menuRow}
        </Box>
      )
    }
    const state = v.state
    const project = projectKeyOf(state.worktree?.id)
    const layout = await readFleetLayout($, project)
    const isShown = (section: PanelSection) => layout.shown.includes(section)
    const catalog = catalogPickerOf($, e, palette, columns, project, layout)
    const marks = sectionMarksOf($, e, project, layout, palette, columns)
    const { isCollapsed } = marks
    const members = teamOrderOf(state).map((agent) => ({
      agent,
      member: memberOf(agent, state, config.rewards)
    }))
    const { party, unseen } = drawnPartyOf(state, config.rewards)
    const level = config.rewards ? levelOf(v.xp) : undefined
    const lead = leadStateOf(state)
    const isLeadAwake = lead !== undefined && lead !== 'sleeping'
    const extras = { isHeroWorking: isSceneShown() || isLeadAwake, level, isDemo: v.isDemo, unseen }
    const art = await animate($, e, [
      {
        key: HUD_KEY,
        columns,
        rows: HUD_ROWS,
        draw: (at: number) =>
          hudCellsOf(scene, party, columns, at, { ...extras, lead: shownLead(), hero: shownHero() })
      },
      ...(isShown('team') && cardLayout.withTile ? members : []).map(({ member }) => ({
        key: `tile-${member.key}`,
        columns: TILE_COLUMNS,
        rows: TILE_ROWS,
        draw: (at: number) =>
          tileCellsOf(
            scene,
            member.isDone ? 'handed' : member.phase,
            member.state,
            at,
            member.mood,
            member.name
          )
      })),
      ...(isShown('team') ? advisorTiles : [])
    ])
    const counts = countsOf(state.agents)
    const fleetPill = (
      <Text key="fleet" backgroundColor={palette.gold} color={palette.ink} bold>
        {` ⚑ ${text.fleet.toLocaleUpperCase()} `}
      </Text>
    )
    const statusParts = statusPartsOf(counts, columns - cellWidthOf(` ⚑ ${text.fleet} `) - 1)
    const statusRow = [
      fleetPill,
      ...statusParts.map((part) => (
        <Text
          key={part.key}
          color={part.key === 'waiting' && !part.isAlert ? 'gray' : STATUS_COLORS[part.key]}
          bold={part.isAlert}
        >
          {part.text}
        </Text>
      ))
    ]
    const fleetModels = fleetAdvisorSummaryOf(state.agents.filter((agent) => agent.isMember))
    const needs = needCalloutsOf(needsOf(state))
    const advisorRowsOf = (agent: GameAgent) => {
      const advisor = agent.isLeader ? (agent.advisor ?? ownAdvisor) : agent.advisor
      return memberModelLinesOf({ advisor, launch: agent.launch }, cardRoom).map((line, row) => (
        <Text key={`jev-${agent.paneKey}-${row}`} color={palette.gold} wrap="wrap">
          {line}
        </Text>
      ))
    }
    const worktreeId = state.worktree?.id ?? ''
    const link = (key: string, url: string, label: string, child: RenderElement) =>
      gameLinkOf($, e, { key, url, worktreeId, label }, child)
    const linkPressOf = (one: PaneLink) => () =>
      one.action === undefined
        ? void openGameLink($, one.url, worktreeId).then((isOpen) => {
            if (!isOpen) {
              $.ui.toast(text.couldNotOpenLink(one.label))
            }
          })
        : void runAction($, one.action, v.isDemo).catch(() => undefined)
    const linkButton = (one: PaneLink) => (
      <Button key={one.key} plain hotkey={one.hotkey} onPress={linkPressOf(one)}>
        <Text backgroundColor={palette.panel} color={palette.parchment}>{` ${one.label} `}</Text>
      </Button>
    )
    const links = paneLinksOf(state)
    const linksRow = isTap ? (
      <Box key="pane-links" flexDirection="column">
        <Text dimColor>{text.openHeading}</Text>
        {tapButtonsOf(
          $,
          e,
          'pane-links-tap',
          links.map((one) =>
            tapOf({
              key: one.key,
              hotkey: one.hotkey,
              labels: [one.label],
              onPress: linkPressOf(one)
            })
          ),
          columns
        )}
      </Box>
    ) : (
      <Box key="pane-links" flexDirection="row" columnGap={1} flexWrap="wrap">
        <Text dimColor>{text.openHeading}</Text>
        {links.map(linkButton)}
      </Box>
    )
    const projectSections = await projectRowsOf(
      $,
      e,
      state,
      palette,
      v.isDemo,
      columns,
      marks,
      isShown
    )
    const flatScore = flatScoreLineOf({ level, recent: v.recent ?? [], isDemo: v.isDemo, columns })
    const cards = !isShown('team')
      ? []
      : isFlat
        ? flatPaneMembers($, e, {
            state,
            palette,
            columns,
            isTap,
            viewLabelOf,
            pressOf: viewPressOf,
            hotkeyOf: viewHotkeyOf
          })
        : members.flatMap(({ agent, member }, index) => [
            memberCard($, e, agent, member, {
              scene,
              room: cardRoom,
              leadTitle: agent.isLeader ? leadTitleOf(state, text.lead) : null,
              cardState: cardStateOf(agent, state),
              tile: art.get(`tile-${member.key}`),
              withTile: cardLayout.withTile,
              view:
                agent.terminalHandle === undefined
                  ? undefined
                  : isTap
                    ? tapView(agent, agent.terminalHandle, index)
                    : view(agent, agent.terminalHandle, index),
              isTap,
              advisorRows: advisorRowsOf(agent),
              link
            })
          ])
    const team = (
      <Box key="section-team" flexDirection="column">
        {marks.headingOf('team', `${text.team} ${state.agents.length}`, {
          isAlert: counts.waiting > 0
        })}
        {!isCollapsed('team') && cards}
        {!isCollapsed('team') && advisorOf(art)}
      </Box>
    )
    const drawn: Readonly<Partial<Record<PanelSection, RenderElement>>> = {
      team,
      ...(isShown('review') ? reviewSectionOf($, e, state, marks, link) : {}),
      ...projectSections
    }
    const shown = layout.order.filter((section) => isShown(section) && drawn[section] != null)
    const sections = shown.map((section) => drawn[section])
    // A one-cell mark is too small to tap, so a phone also gets a chip per section.
    const sectionChips = isTap
      ? sectionChipsOf($, e, palette, columns, project, shown, isCollapsed)
      : null
    return (
      <Box flexDirection="column">
        {isFlat ? flatScore !== undefined && flatLine($, e, flatScore, palette) : art.get(HUD_KEY)}
        {isTap && menuRow}
        {isTap && catalog}
        {sectionChips}
        {/* A blank row on a phone, or the counts read as one more row of the menu chips over them. */}
        <Box
          key={isTap ? 'pane-fleet-chips' : 'pane-fleet-status'}
          flexDirection="column"
          marginTop={isTap ? 1 : 0}
        >
          <Box key="pane-fleet-row" flexDirection="row" columnGap={1}>
            {statusRow}
            {!isTap && fleetModels !== null && <Box key="fleet-spacer" flexGrow={1} />}
            {!isTap && fleetModels !== null && (
              <Text key="fleet-models" color={palette.gold}>
                {fleetModels}
              </Text>
            )}
          </Box>
        </Box>
        {(v.note !== '' || v.isLoading || (isTap && fleetModels !== null)) && (
          <Box flexDirection="row" columnGap={1} flexWrap="wrap">
            {isTap && fleetModels !== null && <Text color={palette.gold}>{fleetModels}</Text>}
            {v.note !== '' && <Text color="yellow">{v.note}</Text>}
            {v.isLoading && <Text dimColor>{text.refreshing}</Text>}
          </Box>
        )}
        {isLead && hostCapacityTextsOf($, e, state.hostCapacity ?? [], isTap)}
        {needs.length > 0 && (
          <Box key="pane-needs" flexDirection="column" marginY={1}>
            {needs.map((need) => (
              <Box
                key={`need-${need.name}`}
                flexDirection="row"
                width={columns}
                backgroundColor={palette.panel}
              >
                <Text color="red">▌ </Text>
                <Text color="red" bold>
                  {need.name}
                </Text>
                <Text color={palette.parchment} wrap="truncate-end">{`  ${need.text}`}</Text>
              </Box>
            ))}
          </Box>
        )}
        {sections}
        {links.length > 0 && linksRow}
        {!isTap && menuRow}
        {!isTap && catalog}
      </Box>
    )
  })
}
