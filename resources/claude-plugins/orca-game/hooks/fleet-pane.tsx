import type { EngineInterface, On, RenderElement } from 'claude-code'

import type { GameAgent } from '../types'
import { advisorCard, advisorCardViewOf } from './advisor-card'
import { ADVISOR_TILE_KEY } from './advisor-tile'
import { petLabelOf } from './band-chips'
import { CI_COLORS, reviewTextOf, workItemTextOf } from './fleet-labels'
import { memberCard } from './fleet-member-card'
import { HUD_ROWS, hudCellsOf } from './fleet-hud'
import { projectRowsOf } from './fleet-project'
import { focusTerminal, openGameLink, refreshSoon, viewOf } from './fleet-sync'
import { TILE_COLUMNS, TILE_ROWS, tileCellsOf } from './fleet-tiles'
import { leadTitleOf } from './game-lead'
import { runAction } from './game-actions'
import { gameLinkOf } from './game-link'
import { gameStrings } from './game-strings'
import { countsOf, memberOf, needsOf } from './party'
import { animate } from './quest'
import { clawdReact, currentScene, gameConfig, isSceneShown, ready } from './quest-runtime'
import { paneLinksOf, type PaneLink } from './pane-links'
import { levelOf } from './rewards'
import { fleetAdvisorSummaryOf, memberAdvisorLinesOf } from './member-advisor'

export const PANE_ID = 'orca-game-fleet'
const HUD_KEY = 'pane-hud'
// A card's text column: the pane less the tile, the round border and the padding on each side.
const CARD_CHROME = TILE_COLUMNS + 4

export async function openPane($: EngineInterface): Promise<void> {
  const title = gameStrings().text.fleet
  await $.ui.open({ id: PANE_ID, title, closeOnEscape: true, focus: true })
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
    const menu = (key: string, hotkey: string, label: string, onPress: () => void) => (
      <Button key={key} plain hotkey={hotkey} onPress={onPress}>
        <Text backgroundColor={palette.panel} color={palette.parchment} bold>{` ${label} `}</Text>
      </Button>
    )
    // Digits follow tile order; r p q are the menu's, i o c w a g t the links'; actions take the rest.
    const view = (agent: GameAgent, handle: string, index: number) => (
      <Button
        key={`view-${agent.paneKey}`}
        plain
        hotkey={index < 9 ? String(index + 1) : undefined}
        onPress={() =>
          void focusTerminal($, handle).then((isFocused) => {
            if (!isFocused) {
              $.ui.toast(text.couldNotOpen(agent.displayName))
            }
          })
        }
      >
        <Text backgroundColor={palette.panel} color={palette.parchment} bold>
          {` ${text.view} `}
        </Text>
      </Button>
    )
    const menuRow = (
      <Box flexDirection="row" columnGap={1} flexWrap="wrap">
        {menu(
          'refresh',
          'r',
          `↻ ${text.refresh}`,
          () => void refreshSoon($).catch(() => undefined)
        )}
        {menu('pet', 'p', petLabelOf(scene), () => clawdReact($, 'pet'))}
        {menu('quit', 'q', `✕ ${text.close}`, close)}
      </Box>
    )
    const advisorView = await advisorCardViewOf($)
    const advisorTiles = advisorView === null ? [] : [advisorView.tile]
    const advisorOf = (art: Map<string, RenderElement>) =>
      advisorView === null
        ? null
        : advisorCard($, e, palette, advisorView.card, art.get(ADVISOR_TILE_KEY))
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
    const members = state.agents.map((agent) => ({
      agent,
      member: memberOf(agent, state, config.rewards)
    }))
    const party = members.filter((one) => !one.agent.isLeader).map((one) => one.member)
    const columns = Math.max(1, Math.min(512, e.props.bodyColumns))
    const level = config.rewards ? levelOf(v.xp) : undefined
    const extras = { isHeroWorking: isSceneShown(), level, isDemo: v.isDemo }
    const art = await animate($, e, [
      {
        key: HUD_KEY,
        columns,
        rows: HUD_ROWS,
        draw: (at: number) => hudCellsOf(scene, party, columns, at, extras)
      },
      ...members.map(({ member }) => ({
        key: `tile-${member.key}`,
        columns: TILE_COLUMNS,
        rows: TILE_ROWS,
        draw: (at: number) =>
          tileCellsOf(scene, member.isDone ? 'handed' : member.phase, member.state, at, member.mood)
      })),
      ...advisorTiles
    ])
    const counts = countsOf(state.agents)
    const fleetModels = fleetAdvisorSummaryOf(state.agents.filter((agent) => agent.isMember))
    const needs = needsOf(state)
    const cardRoom = Math.max(1, columns - CARD_CHROME)
    const advisorRowsOf = (agent: GameAgent) =>
      (agent.advisor === undefined ? [] : memberAdvisorLinesOf(agent.advisor, cardRoom)).map(
        (line, row) => (
          <Text key={`jev-${agent.paneKey}-${row}`} color={palette.gold} wrap="truncate-end">
            {line}
          </Text>
        )
      )
    const worktreeId = state.worktree?.id ?? ''
    const link = (key: string, url: string, label: string, child: RenderElement) =>
      gameLinkOf($, e, { key, url, worktreeId, label }, child)
    const linkButton = (one: PaneLink) => (
      <Button
        key={one.key}
        plain
        hotkey={one.hotkey}
        onPress={() =>
          one.action === undefined
            ? void openGameLink($, one.url, worktreeId).then((isOpen) => {
                if (!isOpen) {
                  $.ui.toast(text.couldNotOpenLink(one.label))
                }
              })
            : void runAction($, one.action, v.isDemo).catch(() => undefined)
        }
      >
        <Text backgroundColor={palette.panel} color={palette.parchment}>{` ${one.label} `}</Text>
      </Button>
    )
    const links = paneLinksOf(state)
    const projectRows = await projectRowsOf($, e, state, palette, v.isDemo)
    return (
      <Box flexDirection="column">
        {art.get(HUD_KEY)}
        <Box flexDirection="row" columnGap={1} flexWrap="wrap">
          <Text backgroundColor={palette.gold} color={palette.ink} bold>
            {` ⚑ ${text.fleet} `}
          </Text>
          <Text color="cyan">{text.working(counts.working)}</Text>
          <Text color="gray">{text.idle(counts.idle)}</Text>
          <Text color="green">{text.done(counts.done)}</Text>
          <Text color={counts.waiting > 0 ? 'red' : 'gray'} bold={counts.waiting > 0}>
            {text.waiting(counts.waiting)}
          </Text>
          {v.note !== '' && <Text color="yellow">{v.note}</Text>}
          {v.isLoading && <Text dimColor>{text.refreshing}</Text>}
          {fleetModels !== null && <Text color={palette.gold}>{fleetModels}</Text>}
        </Box>
        {needs.map((need) => (
          <Text key={`need-${need.name}`} color="red" wrap="truncate-end">
            {` ! ${need.name}  ${need.text}`}
          </Text>
        ))}
        {members.map(({ agent, member }, index) =>
          memberCard($, e, agent, member, {
            scene,
            room: cardRoom,
            leadTitle: agent.isLeader ? leadTitleOf(state, text.lead) : null,
            tile: art.get(`tile-${member.key}`),
            view:
              agent.terminalHandle === undefined
                ? undefined
                : view(agent, agent.terminalHandle, index),
            advisorRows: advisorRowsOf(agent),
            link
          })
        )}
        {advisorOf(art)}
        {state.review !== null && (
          <Box flexDirection="row" gap={1}>
            <Box width={10}>
              <Text dimColor>{text.reviewHeading}</Text>
            </Box>
            {link(
              'pane-review',
              state.review.url,
              reviewTextOf(state.review),
              <Text color={CI_COLORS[state.review.ci]} underline>
                {reviewTextOf(state.review)}
              </Text>
            )}
            <Text dimColor wrap="truncate-end">
              {state.review.title}
            </Text>
          </Box>
        )}
        {state.workItem !== null && (
          <Box flexDirection="row" gap={1}>
            <Box width={10}>
              <Text dimColor>{text.workItemHeading}</Text>
            </Box>
            {state.workItem.url === '' ? (
              <Text>{workItemTextOf(state.workItem)}</Text>
            ) : (
              link(
                'pane-work-item',
                state.workItem.url,
                workItemTextOf(state.workItem),
                <Text underline>{workItemTextOf(state.workItem)}</Text>
              )
            )}
            <Text dimColor wrap="truncate-end">
              {state.workItem.title}
            </Text>
          </Box>
        )}
        {projectRows}
        {links.length > 0 && (
          <Box key="pane-links" flexDirection="row" columnGap={1} flexWrap="wrap">
            <Text dimColor>{text.openHeading}</Text>
            {links.map(linkButton)}
          </Box>
        )}
        {menuRow}
      </Box>
    )
  })
}
