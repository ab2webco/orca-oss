import type { EngineInterface, On, RenderElement } from 'claude-code'

import type { GameAgent } from '../types'
import { advisorCard, advisorCardViewOf } from './advisor-card'
import { advisorPinsOf, ownAdvisorOf } from './advisor-report'
import { advisorNow } from './advisor-state'
import { ADVISOR_TILE_KEY } from './advisor-tile'
import { countChipsOf } from './band-chips'
import { flatLine } from './flat-block'
import { flatPaneMembers } from './flat-rows'
import { isFlatMode } from './flat-toggle'
import { paneMenuItemsOf } from './pane-menu'
import { flatScoreLineOf } from './flat-view'
import { chipRowsOf, type PlacedChip } from './chip-rows'
import { memberHeadingOf } from './fleet-labels'
import { memberCard } from './fleet-member-card'
import { HUD_ROWS, hudCellsOf } from './fleet-hud'
import { projectRowsOf } from './fleet-project'
import { reviewSectionOf } from './fleet-review-section'
import { focusTerminal, openGameLink, viewOf } from './fleet-sync'
import { cardLayoutOf, TILE_COLUMNS, TILE_ROWS, tileCellsOf } from './fleet-tiles'
import { leadTitleOf } from './game-lead'
import { cardStateOf, leadStateOf } from './lead-state'
import { runAction } from './game-actions'
import { gameLinkOf } from './game-link'
import { gameStrings } from './game-strings'
import { countsOf, memberOf, needsOf } from './party'
import { animate } from './quest'
import { currentScene, gameConfig, isSceneShown, ready, shownLead } from './quest-runtime'
import { paneLinksOf, type PaneLink } from './pane-links'
import { projectKeyOf, type PanelSection } from './panel-layout'
import { hintLayoutOnce, readFleetLayout } from './panel-layout-store'
import { sectionChipsOf, sectionMarksOf } from './panel-section-marks'
import { catalogPickerOf } from './panel-widgets'
import { levelOf } from './rewards'
import { fleetAdvisorSummaryOf, memberModelLinesOf, memberModelOf } from './member-advisor'
import { tapButtonsOf, type TapButton } from './tap-buttons'
import { viewPickerOf } from './view-picker'
import { isTapLayout } from './tap-layout'

export const PANE_ID = 'orca-game-fleet'
const HUD_KEY = 'pane-hud'
const FLEET_CHIP_COLORS: Readonly<Record<string, string>> = {
  'fleet-working': 'cyan',
  'fleet-idle': 'gray',
  'fleet-done': 'green'
}

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
    const menu = (key: string, hotkey: string | undefined, label: string, onPress: () => void) => (
      <Button key={key} plain hotkey={hotkey} onPress={onPress}>
        <Text backgroundColor={palette.panel} color={palette.parchment} bold>{` ${label} `}</Text>
      </Button>
    )
    // Digits follow tile order; r p q are the menu's, i o c w a g t the links'; actions take the rest.
    const viewPressOf = (agent: GameAgent, handle: string) => () =>
      void focusTerminal($, handle).then((isFocused) => {
        if (!isFocused) {
          $.ui.toast(text.couldNotOpen(agent.displayName))
        }
      })
    const viewHotkeyOf = (index: number) => (index < 9 ? String(index + 1) : undefined)
    const view = (agent: GameAgent, handle: string, index: number) => (
      <Button
        key={`view-${agent.paneKey}`}
        plain
        hotkey={viewHotkeyOf(index)}
        onPress={viewPressOf(agent, handle)}
      >
        <Text backgroundColor={palette.panel} color={palette.parchment} bold>
          {` ${text.view} `}
        </Text>
      </Button>
    )
    // On a phone View leaves the card's narrow text column for a chip under it.
    const tapView = (agent: GameAgent, handle: string, index: number) =>
      tapButtonsOf(
        $,
        e,
        `view-tap-${agent.paneKey}`,
        [
          {
            ...tapOf({
              key: `view-${agent.paneKey}`,
              labels: [`▸ ${text.view}`],
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
    const menuRow = (
      <Box flexDirection="column">
        {isTap ? (
          tapButtonsOf(
            $,
            e,
            'pane-menu-tap',
            // Close leads on a phone: it is how the pane leaves, and the top rows are what shows.
            [...menuItems.slice(-1), ...menuItems.slice(0, -1)].map((one) => ({
              ...tapOf(one),
              bold: true
            })),
            columns
          )
        ) : (
          <Box flexDirection="row" columnGap={1} flexWrap="wrap">
            {menuItems.map((one) => menu(one.key, one.hotkey, one.labels[0], one.onPress))}
          </Box>
        )}
        {picker}
      </Box>
    )
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
    const marks = sectionMarksOf($, e, project, layout)
    const { isCollapsed } = marks
    const members = state.agents.map((agent) => ({
      agent,
      member: memberOf(agent, state, config.rewards)
    }))
    const party = members.filter((one) => !one.agent.isLeader).map((one) => one.member)
    const level = config.rewards ? levelOf(v.xp) : undefined
    const lead = leadStateOf(state)
    const isLeadAwake = lead !== undefined && lead !== 'sleeping'
    const extras = { isHeroWorking: isSceneShown() || isLeadAwake, level, isDemo: v.isDemo }
    const art = await animate($, e, [
      {
        key: HUD_KEY,
        columns,
        rows: HUD_ROWS,
        draw: (at: number) =>
          hudCellsOf(scene, party, columns, at, { ...extras, lead: shownLead() })
      },
      ...(isShown('team') && cardLayout.withTile ? members : []).map(({ member }) => ({
        key: `tile-${member.key}`,
        columns: TILE_COLUMNS,
        rows: TILE_ROWS,
        draw: (at: number) =>
          tileCellsOf(scene, member.isDone ? 'handed' : member.phase, member.state, at, member.mood)
      })),
      ...(isShown('team') ? advisorTiles : [])
    ])
    const counts = countsOf(state.agents)
    const fleetChipOf = (chip: PlacedChip): RenderElement => {
      const isTeam = chip.key === 'fleet-team'
      const color = FLEET_CHIP_COLORS[chip.key] ?? (counts.waiting > 0 ? 'red' : 'gray')
      return (
        <Text
          key={chip.key}
          backgroundColor={isTeam ? palette.gold : palette.panel}
          color={isTeam ? palette.ink : color}
          bold={isTeam || (chip.key === 'fleet-waiting' && counts.waiting > 0)}
        >
          {` ${chip.label} `}
        </Text>
      )
    }
    // On a phone the counts shorten to the band's marks so they keep to one row.
    const fleetChips = (
      <Box key="pane-fleet-chips" flexDirection="column" marginTop={1}>
        {chipRowsOf(
          [
            { key: 'team', priority: 0, labels: [`⚑ ${text.fleet}`, '⚑'] as const },
            ...countChipsOf(counts)
          ].map((chip) => ({ ...chip, key: `fleet-${chip.key}` })),
          { columns, maxRows: 1 }
        ).map((row) => (
          <Box key={`pane-fleet-${row[0]?.key ?? 'empty'}`} flexDirection="row" columnGap={1}>
            {row.map(fleetChipOf)}
          </Box>
        ))}
      </Box>
    )
    const fleetModels = fleetAdvisorSummaryOf(state.agents.filter((agent) => agent.isMember))
    const needs = needsOf(state)
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
            viewLabel: text.view,
            pressOf: viewPressOf,
            hotkeyOf: viewHotkeyOf
          })
        : members.flatMap(({ agent, member }, index) => [
            memberCard($, e, agent, member, {
              scene,
              room: cardRoom,
              leadTitle: agent.isLeader ? leadTitleOf(state, text.lead) : null,
              cardState: cardStateOf(agent, state),
              tile: cardLayout.withTile ? art.get(`tile-${member.key}`) : null,
              view:
                agent.terminalHandle === undefined || isTap
                  ? undefined
                  : view(agent, agent.terminalHandle, index),
              advisorRows: advisorRowsOf(agent),
              link
            }),
            ...(agent.terminalHandle === undefined || !isTap
              ? []
              : [tapView(agent, agent.terminalHandle, index)])
          ])
    const team = (
      <Box key="section-team" flexDirection="column">
        <Box key="layout-header-team" flexDirection="row">
          {marks.markOf('team')}
          <Text bold color={counts.waiting > 0 ? 'red' : undefined}>
            {`${text.team} ${state.agents.length}`}
          </Text>
        </Box>
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
        <Box flexDirection="row" columnGap={1} flexWrap="wrap">
          {isTap
            ? fleetChips
            : [
                <Text key="fleet" backgroundColor={palette.gold} color={palette.ink} bold>
                  {` ⚑ ${text.fleet} `}
                </Text>,
                <Text key="working" color="cyan">
                  {text.working(counts.working)}
                </Text>,
                <Text key="idle" color="gray">
                  {text.idle(counts.idle)}
                </Text>,
                <Text key="done" color="green">
                  {text.done(counts.done)}
                </Text>,
                <Text
                  key="waiting"
                  color={counts.waiting > 0 ? 'red' : 'gray'}
                  bold={counts.waiting > 0}
                >
                  {text.waiting(counts.waiting)}
                </Text>
              ]}
          {v.note !== '' && <Text color="yellow">{v.note}</Text>}
          {v.isLoading && <Text dimColor>{text.refreshing}</Text>}
          {fleetModels !== null && <Text color={palette.gold}>{fleetModels}</Text>}
        </Box>
        {needs.map((need) => (
          <Text key={`need-${need.name}`} color="red" wrap="truncate-end">
            {` ! ${need.name}  ${need.text}`}
          </Text>
        ))}
        {sections}
        {links.length > 0 && linksRow}
        {!isTap && menuRow}
        {!isTap && catalog}
      </Box>
    )
  })
}
