import type { EngineInterface, On, RenderElement } from 'claude-code'

import { alliesStrip } from './allies-strip'
import { CHIP_ROWS, MENU_ROWS, menuChipsOf, stateChipsOf } from './band-chips'
import { fitCells } from './cell-width'
import { chipRowsOf, MORE_CHIP_KEY, type Chip, type PlacedChip } from './chip-rows'
import { needPartsOf } from './fleet-labels'
import { HUD_KEY, HUD_MIN_COLUMNS, HUD_ROWS, hudCellsOf, hudLineOf, xpTextOf } from './fleet-hud'
import { runAction } from './game-actions'
import { gameLinkOf } from './game-link'
import { gameStrings } from './game-strings'
import { memberBandRows } from './member-band'
import { isMemberPane } from './member-pane'
import { ACTION_CHIP_PREFIX, actionChipsOf } from './lead-actions'
import { isPaneShown, openPane } from './fleet-pane'
import { refreshSoon, viewOf } from './fleet-sync'
import { countsOf, drawnPartyOf, needsOf } from './party'
import { animate } from './quest'
import {
  clawdReact,
  currentScene,
  gameConfig,
  isAdvisorActing,
  isClawdReacting,
  isSceneShown,
  petScene,
  shownLead,
  ready
} from './quest-runtime'
import { levelOf } from './rewards'
import { tapButtonsOf, type TapButton } from './tap-buttons'
import { isTapLayout } from './tap-layout'
import { flatBandRows } from './flat-rows'
import { isFlatMode, toggleFlat } from './flat-toggle'

const PET_KEY = 'band-pet-scene'
const ACTION_ROWS = 1
// A phone's band is one row of chips: the menu, then the actions that fit and a `+N` opening the Panel.
const TAP_KEY = 'band-tap'
const TAP_ROWS_MAX = 1

// Core's own band is left out as before; a plugin drawn beneath keeps its place under the game's.
const beneathOf = (drawn: RenderElement): RenderElement[] =>
  drawn.type === 'engine' ? [] : [drawn]

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
    const [beneath, isPanelShown] = await Promise.all([next(e).then(beneathOf), isPaneShown($)])
    const isMember = isMemberPane(v.state)
    const allies = await alliesStrip($, e, palette, columns, isPanelShown, isMember)
    // Why no menu, team or actions: a member reports to its lead and never runs the team.
    if (isMember) {
      const { Box } = $.ui.resolve(e)
      return (
        <Box flexDirection="column">
          {memberBandRows($, e, { state: v.state, palette, columns })}
          {allies}
          {beneath}
        </Box>
      )
    }
    const { Box, Text, Button } = $.ui.resolve(e)
    const text = gameStrings().text
    // Why Jev too: CI often lands while the lead is idle, when no spinner draws the scene.
    // Why isWorking: the spinner draws the scene all turn, and its stage count can lag or drop.
    const showPet =
      !e.props.isWorking && (isClawdReacting() || isAdvisorActing()) && !isSceneShown()
    const pet = showPet ? [petScene(PET_KEY, columns)] : []
    const rowsOf = (
      prefix: string,
      chips: readonly Chip[],
      maxRows: number,
      draw: (chip: PlacedChip) => RenderElement,
      more?: (count: number) => string
    ) =>
      chipRowsOf(chips, { columns, maxRows, more }).map((row) => (
        <Box key={`${prefix}-${row[0]?.key ?? 'empty'}`} flexDirection="row" gap={1}>
          {row.map(draw)}
        </Box>
      ))
    const menuActions: Readonly<Record<string, () => void>> = {
      'band-panel': () => openFleet($),
      'band-flat': () => void toggleFlat($).catch(() => undefined),
      'band-refresh': () => void refreshSoon($).catch(() => undefined),
      'band-pet': () => clawdReact($, 'pet')
    }
    const isTap = isTapLayout(columns)
    const isFlat = isFlatMode()
    // Why no Pet on a phone: its one row keeps the flat toggle; the Panel still offers Pet.
    const menuChips = menuChipsOf(currentScene(), isFlat).filter(
      (chip) => !isTap || chip.key !== 'band-pet'
    )
    const menuTaps: TapButton[] = menuChips.map((chip) => ({
      key: chip.key,
      // Why Panel keeps its word: actions drop into its +N before it turns into a bare icon.
      labels: chip.key === 'band-panel' ? [chip.labels[0]] : chip.labels,
      onPress: menuActions[chip.key] ?? (() => undefined),
      backgroundColor: chip.key === 'band-panel' ? palette.gold : palette.panel,
      color: chip.key === 'band-panel' ? palette.ink : palette.parchment,
      bold: true
    }))
    const menuRows = isTap
      ? [tapButtonsOf($, e, TAP_KEY, menuTaps, columns, { maxRows: TAP_ROWS_MAX })]
      : rowsOf('band-menu', menuChips, MENU_ROWS, (chip) => (
          <Button key={chip.key} plain onPress={menuActions[chip.key] ?? (() => undefined)}>
            <Text
              backgroundColor={chip.key === 'band-panel' ? palette.gold : palette.panel}
              color={chip.key === 'band-panel' ? palette.ink : palette.parchment}
              bold
            >{` ${chip.label} `}</Text>
          </Button>
        ))
    if (v.state === null) {
      const art = await animate($, e, pet)
      return (
        <Box flexDirection="column">
          {art.get(PET_KEY)}
          <Text dimColor wrap="truncate-end">
            {fitCells(`${text.team} · ${v.note === '' ? text.loading : v.note}`, columns)}
          </Text>
          {menuRows}
          {allies}
          {beneath}
        </Box>
      )
    }
    const state = v.state
    const { party, unseen } = drawnPartyOf(state, config.rewards)
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
          isDemo: v.isDemo,
          lead: shownLead(),
          unseen
        })
    }
    const isFramed = columns >= HUD_MIN_COLUMNS
    const isArtShown = config.mode !== 'off' && e.surface === 'terminal'
    const art = await animate($, e, isFramed && !isPanelShown ? [...pet, hud] : pet)
    const worktreeId = state.worktree?.id ?? ''
    const linkOf = (key: string, url: string, label: string, child: RenderElement) =>
      url === '' ? child : gameLinkOf($, e, { key, url, worktreeId, label }, child)
    const pill = (key: string, label: string, color: string, isBold = false) => (
      <Text key={key} backgroundColor={palette.panel}>
        {' '}
        <Text color={color} bold={isBold}>
          {label}
        </Text>{' '}
      </Text>
    )
    const chips = stateChipsOf(state, counts, party.length + unseen, v.note, v.isLoading)
    const linked = new Map(chips.filter((one) => one.isLink).map((one) => [one.key, one]))
    const actions = new Map(
      (state.actions ?? []).map((one) => [`${ACTION_CHIP_PREFIX}${one.id}`, one])
    )
    const chipOf = (chip: PlacedChip): RenderElement => {
      const link = linked.get(chip.key)
      const todoAction =
        link?.actionId === undefined
          ? undefined
          : actions.get(`${ACTION_CHIP_PREFIX}${link.actionId}`)
      if (todoAction !== undefined) {
        return (
          <Button
            key={chip.key}
            plain
            onPress={() => void runAction($, todoAction, v.isDemo).catch(() => undefined)}
          >
            <Text color={link?.color ?? palette.parchment} backgroundColor={palette.panel}>
              {` ${chip.label} `}
            </Text>
          </Button>
        )
      }
      if (link !== undefined) {
        return linkOf(
          chip.key,
          link.href ?? '',
          chip.label,
          <Text
            key={chip.key}
            color={link.color ?? palette.parchment}
            backgroundColor={palette.panel}
          >
            {` ${chip.label} `}
          </Text>
        )
      }
      switch (chip.key) {
        case 'band-team':
          return (
            <Button key={chip.key} plain onPress={() => openFleet($)}>
              <Text backgroundColor={palette.gold} color={palette.ink} bold>
                {' ⚑ '}
                <Text bold>{chip.label.replace(/^⚑ /, '')}</Text>{' '}
              </Text>
            </Button>
          )
        case 'working':
          return pill(chip.key, chip.label, 'cyan')
        case 'done':
          return pill(chip.key, chip.label, 'green')
        case 'band-github-low':
          return pill(chip.key, chip.label, 'yellow', true)
        case 'waiting':
          return pill(chip.key, chip.label, counts.waiting > 0 ? 'red' : 'gray', counts.waiting > 0)
        case 'note':
          return <Text key={chip.key} color="yellow">{` ${chip.label} `}</Text>
        case MORE_CHIP_KEY:
          return <Text key={chip.key} dimColor>{` ${chip.label} `}</Text>
        case 'loading':
          return <Text key={chip.key} dimColor>{` ${chip.label} `}</Text>
        default:
          return pill(chip.key, chip.label, 'gray')
      }
    }
    const actionPressOf = (key: string) => () => {
      const action = actions.get(key)
      if (action === undefined) {
        openFleet($)
        return
      }
      void runAction($, action, v.isDemo).catch(() => undefined)
    }
    const tapRow = isTap
      ? tapButtonsOf(
          $,
          e,
          TAP_KEY,
          [
            ...menuTaps,
            ...actionChipsOf([...actions.values()]).map((chip) => ({
              key: chip.key,
              labels: chip.labels,
              onPress: actionPressOf(chip.key),
              backgroundColor: palette.panel,
              color: palette.parchment
            }))
          ],
          columns,
          {
            maxRows: TAP_ROWS_MAX,
            more: {
              key: 'band-actions-more',
              labelOf: (count) => `+${count}`,
              onPress: () => openFleet($),
              backgroundColor: palette.panel,
              color: palette.parchment
            }
          }
        )
      : null
    // The lead's and the project's buttons; the +N that hides the rest opens the Panel's full row.
    const actionRows = rowsOf(
      'band-actions',
      actionChipsOf([...actions.values()]),
      ACTION_ROWS,
      (chip) => (
        <Button key={chip.key} plain onPress={actionPressOf(chip.key)}>
          <Text backgroundColor={palette.panel} color={palette.parchment}>
            {` ${chip.label} `}
          </Text>
        </Button>
      ),
      (count) => `+${count}`
    )
    return (
      <Box flexDirection="column">
        {art.get(PET_KEY)}
        {/* Why: the shown Panel draws the same team; the band keeps the cloud's scene and progress. */}
        {isPanelShown ? (
          level !== undefined && (
            <Box key="band-progress" flexDirection="row" overflow="hidden">
              <Text color={palette.parchment} backgroundColor={palette.panel} wrap="truncate-end">
                {fitCells([...(v.isDemo ? ['DEMO'] : []), xpTextOf(level)].join(' · '), columns)}
              </Text>
            </Box>
          )
        ) : isFlat ? (
          flatBandRows($, e, { state, palette, columns, level, recent: v.recent, isDemo: v.isDemo })
        ) : isFramed || !isArtShown ? (
          art.get(HUD_KEY)
        ) : (
          <Box key="band-hud-line" flexDirection="row" overflow="hidden">
            <Text color={palette.parchment} backgroundColor={palette.panel} wrap="truncate-end">
              {hudLineOf(party, columns, { level, isDemo: v.isDemo, unseen })}
            </Text>
          </Box>
        )}
        {rowsOf('band-chips', chips, CHIP_ROWS, chipOf, (count) => `+${count}`)}
        {needs.length > 0 && (
          <Box key="band-needs" flexDirection="row" overflow="hidden">
            {config.openLinks === 'system' ? (
              // Why one Text per part: a system-browser link is a Button, which no Text may hold.
              needPartsOf(needs, columns).map((part) =>
                linkOf(
                  part.key,
                  part.url ?? '',
                  part.text,
                  <Text key={part.key} color="red" bold wrap="truncate-end">
                    {part.text}
                  </Text>
                )
              )
            ) : (
              <Text color="red" bold wrap="truncate-end">
                {needPartsOf(needs, columns).map((part) =>
                  linkOf(
                    part.key,
                    part.url ?? '',
                    part.text,
                    <Text key={part.key}>{part.text}</Text>
                  )
                )}
              </Text>
            )}
          </Box>
        )}
        {isTap ? tapRow : [...actionRows, ...menuRows]}
        {allies}
        {beneath}
      </Box>
    )
  })
}
