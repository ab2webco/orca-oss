import type { EngineInterface, On, RenderElement } from 'claude-code'

import { CI_COLORS, needsLineOf, reviewTextOf, teammatesOf, workItemTextOf } from './fleet-labels'
import { HUD_KEY, HUD_ROWS, hudCellsOf } from './fleet-hud'
import { openPane } from './fleet-pane'
import { refreshSoon, viewOf } from './fleet-sync'
import { countsOf, needsOf, partyOf } from './party'
import { animate } from './quest'
import {
  clawdReact,
  currentScene,
  gameConfig,
  isClawdReacting,
  isSceneShown,
  petScene,
  ready
} from './quest-runtime'
import { levelOf } from './rewards'

const PET_KEY = 'band-pet-scene'

function openFleet($: EngineInterface): void {
  void openPane($)
    .then(() => refreshSoon($))
    .catch(() => undefined)
}

export const registerBand = (on: On): void => {
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) {
      return next(e)
    }
    await ready($)
    const config = gameConfig()
    if (!config.hud) {
      return next(e)
    }
    const v = await viewOf($)
    const palette = currentScene().band
    const columns = Math.max(1, Math.min(512, e.props.bodyColumns))
    const { Box, Text, Button, Link } = $.ui.resolve(e)
    const showPet = isClawdReacting() && !isSceneShown()
    const pet = showPet ? [petScene(PET_KEY, columns)] : []
    const menu = (
      key: string,
      icon: string,
      label: string,
      onPress: () => void,
      isMain = false
    ) => (
      <Button key={key} plain onPress={onPress}>
        <Text
          backgroundColor={isMain ? palette.gold : palette.panel}
          color={isMain ? palette.ink : palette.parchment}
          bold
        >{` ${icon} ${label} `}</Text>
      </Button>
    )
    const pill = (key: string, label: string, color: string, isBold = false) => (
      <Text key={key} backgroundColor={palette.panel}>
        {' '}
        <Text color={color} bold={isBold}>
          {label}
        </Text>{' '}
      </Text>
    )
    const menuRow = (
      <Box flexDirection="row" gap={1} flexWrap="wrap">
        {menu('band-panel', '▤', 'Panel', () => openFleet($), true)}
        {menu('band-refresh', '↻', 'Refresh', () => void refreshSoon($).catch(() => undefined))}
        {menu('band-pet', '♥', 'Pet Clawd', () => clawdReact($, 'pet'))}
      </Box>
    )
    if (v.state === null) {
      const art = await animate($, e, pet)
      return (
        <Box flexDirection="column">
          {art.get(PET_KEY)}
          <Text dimColor>{`Team · ${v.note === '' ? 'loading…' : v.note}`}</Text>
          {menuRow}
        </Box>
      )
    }
    const state = v.state
    const party = partyOf(state, config.rewards)
    const counts = countsOf(state.agents)
    const needs = needsOf(state)
    const level = config.rewards ? levelOf(v.xp) : undefined
    const hud = {
      key: HUD_KEY,
      columns,
      rows: HUD_ROWS,
      draw: (at: number) =>
        hudCellsOf(currentScene(), party, columns, at, {
          isHeroWorking: isSceneShown(),
          level,
          isDemo: v.isDemo
        })
    }
    const art = await animate($, e, [...pet, hud])
    const linkOf = (key: string, url: string, child: RenderElement) =>
      url === '' ? (
        child
      ) : (
        <Link key={key} href={url}>
          {child}
        </Link>
      )
    return (
      <Box flexDirection="column">
        {art.get(PET_KEY)}
        {art.get(HUD_KEY)}
        <Box flexDirection="row" flexWrap="wrap" gap={1}>
          <Button key="band-team" plain onPress={() => openFleet($)}>
            <Text backgroundColor={palette.gold} color={palette.ink} bold>
              {' ⚑ '}
              <Text bold>{teammatesOf(party.length)}</Text>{' '}
            </Text>
          </Button>
          {pill('working', `${counts.working} working`, 'cyan')}
          {pill('idle', `${counts.idle} idle`, 'gray')}
          {counts.done > 0 && pill('done', `${counts.done} done`, 'green')}
          {pill(
            'waiting',
            `${counts.waiting} waiting on you`,
            counts.waiting > 0 ? 'red' : 'gray',
            counts.waiting > 0
          )}
          {state.review !== null &&
            linkOf(
              'band-review',
              state.review.url,
              <Text color={CI_COLORS[state.review.ci]} backgroundColor={palette.panel}>
                {` ${reviewTextOf(state.review)} `}
              </Text>
            )}
          {state.workItem !== null &&
            linkOf(
              'band-work-item',
              state.workItem.url,
              <Text color={palette.parchment} backgroundColor={palette.panel}>
                {` ${workItemTextOf(state.workItem)} `}
              </Text>
            )}
          {v.note !== '' && <Text color="yellow">{v.note}</Text>}
          {v.isLoading && <Text dimColor>↻</Text>}
        </Box>
        {needs.length > 0 && (
          <Box flexDirection="row" overflow="hidden">
            <Text color="red" bold wrap="truncate-end">
              {needsLineOf(needs)}
            </Text>
          </Box>
        )}
        {menuRow}
      </Box>
    )
  })
}
