import type { EngineInterface, On } from 'claude-code'

import type { GameAgent } from '../types'
import { fitCells } from './cell-width'
import {
  activityTextOf,
  AGENT_COLORS,
  CI_COLORS,
  reviewTextOf,
  workItemTextOf
} from './fleet-labels'
import { HUD_ROWS, hudCellsOf } from './fleet-hud'
import { projectRowsOf } from './fleet-project'
import { focusTerminal, openInOrca, refreshSoon, viewOf } from './fleet-sync'
import { TILE_COLUMNS, TILE_ROWS, tileCellsOf } from './fleet-tiles'
import { leadTitleOf } from './game-lead'
import { runAction } from './game-actions'
import { gameStrings } from './game-strings'
import { countsOf, memberOf, needsOf } from './party'
import { animate } from './quest'
import { clawdReact, currentScene, gameConfig, isSceneShown, ready } from './quest-runtime'
import { paneLinksOf, type PaneLink } from './pane-links'
import { levelOf } from './rewards'

export const PANE_ID = 'orca-game-fleet'
const HUD_KEY = 'pane-hud'
// A card's text column: the pane less the tile, the round border and the padding.
const CARD_CHROME = TILE_COLUMNS + 3

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
    const { Box, Text, Button, Link } = $.ui.resolve(e)
    const text = gameStrings().text
    const close = () => void $.ui.close({ id: PANE_ID }).catch(() => undefined)
    const menu = (key: string, hotkey: string, label: string, onPress: () => void) => (
      <Button key={key} plain hotkey={hotkey} onPress={onPress}>
        <Text backgroundColor={palette.panel} color={palette.parchment} bold>{` ${label} `}</Text>
      </Button>
    )
    // Digits follow tile order; r p q are the menu's, i o c w a g t the links', e f h j k l the actions'.
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
      <Box flexDirection="row" gap={1} flexWrap="wrap" marginTop={1}>
        {menu(
          'refresh',
          'r',
          `↻ ${text.refresh}`,
          () => void refreshSoon($).catch(() => undefined)
        )}
        {menu('pet', 'p', `♥ ${text.petClawd}`, () => clawdReact($, 'pet'))}
        {menu('quit', 'q', `✕ ${text.close}`, close)}
      </Box>
    )
    if (v.state === null) {
      return (
        <Box flexDirection="column">
          <Text dimColor>{`${text.fleet} · ${v.note === '' ? text.loading : v.note}`}</Text>
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
      }))
    ])
    const counts = countsOf(state.agents)
    const needs = needsOf(state)
    const cardRoom = Math.max(1, columns - CARD_CHROME)
    const worktreeId = state.worktree?.id ?? ''
    const linkButton = (one: PaneLink) => (
      <Button
        key={one.key}
        plain
        hotkey={one.hotkey}
        onPress={() =>
          one.action === undefined
            ? void openInOrca($, one.url, worktreeId).then((isOpen) => {
                if (!isOpen) {
                  $.ui.toast(text.couldNotOpenLink(one.label))
                }
              })
            : void runAction($, one.action, v.isDemo).catch(() => undefined)
        }
      >
        <Text backgroundColor={palette.panel} color={palette.parchment}>
          {' '}
          <Text color={palette.gold} bold>
            {one.hotkey}
          </Text>
          {` ${one.label} `}
        </Text>
      </Button>
    )
    const links = paneLinksOf(state)
    const projectRows = await projectRowsOf($, e, state, palette, v.isDemo)
    return (
      <Box flexDirection="column">
        {art.get(HUD_KEY)}
        <Box flexDirection="row" gap={1} flexWrap="wrap">
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
        </Box>
        {needs.map((need) => (
          <Text key={`need-${need.name}`} color="red" wrap="truncate-end">
            {` ! ${need.name}  ${need.text}`}
          </Text>
        ))}
        {members.map(({ agent, member }, index) => (
          <Box
            key={`card-${agent.paneKey}`}
            flexDirection="row"
            borderStyle="round"
            borderColor={AGENT_COLORS[agent.state]}
          >
            {art.get(`tile-${member.key}`) ?? <Box width={TILE_COLUMNS} />}
            <Box flexDirection="column" paddingLeft={1} flexGrow={1} flexShrink={1}>
              <Box flexDirection="row" gap={1}>
                <Text color={AGENT_COLORS[agent.state]} bold>
                  {agent.displayName}
                </Text>
                {agent.isLeader && (
                  <Text color={palette.gold}>{`♛ ${leadTitleOf(state, text.lead)}`}</Text>
                )}
                <Text color={AGENT_COLORS[agent.state]}>{text.agentStates[agent.state]}</Text>
                <Text dimColor>{agent.agentType}</Text>
                {agent.worktree !== undefined && (
                  <Text
                    dimColor
                    wrap="truncate-end"
                  >{`⎇ ${agent.worktree.branch || agent.worktree.displayName}`}</Text>
                )}
                {agent.terminalHandle !== undefined && view(agent, agent.terminalHandle, index)}
              </Box>
              <Text wrap="truncate-end">{member.says}</Text>
              {(agent.review !== undefined || agent.workItem !== undefined) && (
                <Box flexDirection="row" gap={1}>
                  {agent.review !== undefined && (
                    <Link href={agent.review.url}>
                      <Text color={CI_COLORS[agent.review.ci]} underline>
                        {reviewTextOf(agent.review)}
                      </Text>
                    </Link>
                  )}
                  {agent.workItem !== undefined &&
                    (agent.workItem.url === '' ? (
                      <Text>{workItemTextOf(agent.workItem)}</Text>
                    ) : (
                      <Link href={agent.workItem.url}>
                        <Text underline wrap="truncate-end">
                          {workItemTextOf(agent.workItem)}
                        </Text>
                      </Link>
                    ))}
                </Box>
              )}
              {agent.activity !== undefined && (
                <Link key={`activity-${agent.paneKey}`} href={agent.activity.url}>
                  <Text
                    color={agent.activity.running ? 'cyan' : palette.parchment}
                    wrap="truncate-end"
                  >
                    {fitCells(
                      activityTextOf({
                        name: agent.activity.name,
                        label: agent.activity.id,
                        running: agent.activity.running
                      }),
                      cardRoom
                    )}
                  </Text>
                </Link>
              )}
            </Box>
          </Box>
        ))}
        {state.review !== null && (
          <Box flexDirection="row" gap={1}>
            <Box width={10}>
              <Text dimColor>{text.reviewHeading}</Text>
            </Box>
            <Link href={state.review.url}>
              <Text color={CI_COLORS[state.review.ci]} underline>
                {reviewTextOf(state.review)}
              </Text>
            </Link>
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
              <Link href={state.workItem.url}>
                <Text underline>{workItemTextOf(state.workItem)}</Text>
              </Link>
            )}
            <Text dimColor wrap="truncate-end">
              {state.workItem.title}
            </Text>
          </Box>
        )}
        {projectRows}
        {links.length > 0 && (
          <Box key="pane-links" flexDirection="row" gap={1} flexWrap="wrap">
            <Text dimColor>{text.openHeading}</Text>
            {links.map(linkButton)}
          </Box>
        )}
        {menuRow}
      </Box>
    )
  })
}
