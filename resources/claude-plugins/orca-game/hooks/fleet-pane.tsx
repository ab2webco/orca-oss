import type { EngineInterface, On } from 'claude-code'

import type { GameAgent } from '../types'
import { AGENT_COLORS, CI_COLORS, reviewTextOf, workItemTextOf } from './fleet-labels'
import { HUD_ROWS, hudCellsOf } from './fleet-hud'
import { focusTerminal, refreshSoon, viewOf } from './fleet-sync'
import { TILE_COLUMNS, TILE_ROWS, tileCellsOf } from './fleet-tiles'
import { countsOf, memberOf, needsOf } from './party'
import { animate } from './quest'
import { clawdReact, currentScene, gameConfig, isSceneShown, ready } from './quest-runtime'
import { levelOf } from './rewards'

export const PANE_ID = 'orca-game-fleet'
const HUD_KEY = 'pane-hud'

export async function openPane($: EngineInterface): Promise<void> {
  await $.ui.open({ id: PANE_ID, title: 'Fleet', closeOnEscape: true, focus: true })
}

export const registerFleetPane = (on: On): void => {
  on('ui.render', { component: 'Pane', requestId: PANE_ID }, async ($, e) => {
    await ready($)
    const v = await viewOf($)
    const config = gameConfig()
    const scene = currentScene()
    const palette = scene.band
    const { Box, Text, Button, Link } = $.ui.resolve(e)
    const close = () => void $.ui.close({ id: PANE_ID }).catch(() => undefined)
    const menu = (key: string, hotkey: string, label: string, onPress: () => void) => (
      <Button key={key} plain hotkey={hotkey} onPress={onPress}>
        <Text backgroundColor={palette.panel} color={palette.parchment} bold>{` ${label} `}</Text>
      </Button>
    )
    // Digits follow tile order; r, c and q stay the menu's.
    const view = (agent: GameAgent, handle: string, index: number) => (
      <Button
        key={`view-${agent.paneKey}`}
        plain
        hotkey={index < 9 ? String(index + 1) : undefined}
        onPress={() =>
          void focusTerminal($, handle).then((isFocused) => {
            if (!isFocused) {
              $.ui.toast(`Could not open ${agent.displayName}'s pane`)
            }
          })
        }
      >
        <Text backgroundColor={palette.panel} color={palette.parchment} bold>
          {' View '}
        </Text>
      </Button>
    )
    const menuRow = (
      <Box flexDirection="row" gap={1} flexWrap="wrap" marginTop={1}>
        {menu('refresh', 'r', '↻ Refresh', () => void refreshSoon($).catch(() => undefined))}
        {menu('pet', 'c', '♥ Pet Clawd', () => clawdReact($, 'pet'))}
        {menu('quit', 'q', '✕ Close', close)}
      </Box>
    )
    if (v.state === null) {
      return (
        <Box flexDirection="column">
          <Text dimColor>{`Fleet · ${v.note === '' ? 'loading…' : v.note}`}</Text>
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
    return (
      <Box flexDirection="column">
        {art.get(HUD_KEY)}
        <Box flexDirection="row" gap={1} flexWrap="wrap">
          <Text backgroundColor={palette.gold} color={palette.ink} bold>
            {' ⚑ Fleet '}
          </Text>
          <Text color="cyan">{`${counts.working} working`}</Text>
          <Text color="gray">{`${counts.idle} idle`}</Text>
          <Text color="green">{`${counts.done} done`}</Text>
          <Text color={counts.waiting > 0 ? 'red' : 'gray'} bold={counts.waiting > 0}>
            {`${counts.waiting} waiting on you`}
          </Text>
          {v.note !== '' && <Text color="yellow">{v.note}</Text>}
          {v.isLoading && <Text dimColor>(refreshing)</Text>}
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
                {agent.isLeader && <Text color={palette.gold}>♛ lead</Text>}
                <Text color={AGENT_COLORS[agent.state]}>
                  {agent.state === 'waiting' ? '! waiting' : agent.state}
                </Text>
                <Text dimColor>{agent.agentType}</Text>
                {agent.terminalHandle !== undefined && view(agent, agent.terminalHandle, index)}
              </Box>
              <Text wrap="truncate-end">{member.says}</Text>
            </Box>
          </Box>
        ))}
        {state.review !== null && (
          <Box flexDirection="row" gap={1}>
            <Box width={10}>
              <Text dimColor>Review</Text>
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
              <Text dimColor>Work item</Text>
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
        {menuRow}
      </Box>
    )
  })
}
