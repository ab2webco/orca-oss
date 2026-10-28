import type { EngineInterface, On } from 'claude-code'

import { arcadeCaptionOf, arcadeLoopOf, type ArcadeLoop, type ArcadeScreen } from './arcade-loop'
import {
  ARCADE_OFFER_SECONDS,
  arcadeCountdownOf,
  arcadeOfferLineOf,
  type ArcadeCountdown
} from './arcade-offer'
import { runnerOf, runnerStartOf, type Runner, type RunnerState } from './arcade-runner'
import { ARCADE_RUNNER } from './arcade-runner-data'
import { ARCADE_ROWS, arcadeGridOf, arcadeShapesOf, type ArcadeShape } from './arcade-runner-frame'
import { arcadeWords } from './arcade-words'
import { gameStrings } from './game-strings'
import { raiseTeamEvent } from './hd-team'
import { pendingQuestion } from './member-pane'
import { cellsOf } from './pixel-canvas'
import { clawdReact, currentScene, ready } from './quest-runtime'
import { quest } from './quest-state'
import type { SceneDefinition } from './scenes/index'

// The runner in a pane of its own, opened as the demo's practice run or as an offer to play one:
// nothing it scores is kept.

export const ARCADE_PANE = 'orca-game-arcade'
export const ARCADE_JUMP_KEY = 'j'
const RASTER_KEY = 'arcade'
const JUMP_BUTTON = 'arcade-jump'
const CLOSE_BUTTON = 'arcade-close'
const PLAY_BUTTON = 'arcade-play'
const PASS_BUTTON = 'arcade-pass'
const OFFER_LINE = 'arcade-offer'
const PASS_KEY = 'n'
// Why a key besides Esc: a phone has none.
const CLOSE_KEY = 'q'
const MIN_COLUMNS = 20
const MAX_COLUMNS = 160

type View = {
  state: RunnerState
  screen: ArcadeScreen
  columns: number
  tick: number
  /** Set while the run is only offered: the seconds left to answer. */
  offer?: { left: number; isHeld: boolean }
}

type Arcade = {
  scene: SceneDefinition
  runner: Runner<ArcadeShape>
  loop: ArcadeLoop
  view: View
  countdown?: ArcadeCountdown
}

// Why module memory and not $.state or $.store: a practice run ends with its pane and leaves nothing.
let arcade: Arcade | undefined

const cellsNow = ({ scene, runner, view }: Arcade): string =>
  cellsOf(
    arcadeGridOf({
      scene,
      runner,
      state: view.state,
      columns: view.columns,
      rows: ARCADE_ROWS,
      tick: view.tick,
      caption:
        view.offer === undefined
          ? arcadeCaptionOf(view.screen, view.state.score)
          : arcadeWords().unlocked
    })
  )

// A teammate waiting on the user, or this member's own question to its lead, holds the game.
const isHeld = (): boolean => quest.alert !== '' || pendingQuestion() !== undefined

const closeArcade = (): void => {
  arcade?.loop.stop()
  arcade?.countdown?.stop()
  arcade = undefined
}

function closePane($: EngineInterface): void {
  closeArcade()
  void $.ui.close({ id: ARCADE_PANE }).catch(() => undefined)
}

// Why no `focus: false`: the host takes only true or nothing, and nothing leaves the prompt focused.
async function openPane($: EngineInterface, title: string, isFocused: boolean): Promise<void> {
  await $.ui.open({
    id: ARCADE_PANE,
    title,
    closeOnEscape: true,
    ...(isFocused ? { focus: true } : {})
  })
}

async function blitArcade($: EngineInterface, own: Arcade): Promise<void> {
  const { columns } = own.view
  const result = await $.ui
    .blit({
      requestId: ARCADE_PANE,
      key: RASTER_KEY,
      cells: cellsNow(own),
      columns,
      rows: ARCADE_ROWS
    })
    .catch(() => ({ deny: 'failed' }))
  if (result.deny !== undefined && arcade === own) {
    closeArcade()
  }
}

/**
 * Opens the arcade pane on a fresh run of the built-in runner in the active scene. An offer
 * celebrates first and asks for the keyboard, so its j and n never reach the prompt; the host
 * grants it only over an empty composer, and the offer leaves it there while someone needs the user.
 */
export async function openArcade($: EngineInterface, isOffer = false): Promise<void> {
  closeArcade()
  const scene = currentScene()
  const runner = runnerOf(ARCADE_RUNNER, arcadeShapesOf(ARCADE_RUNNER, scene.looks.working))
  const seed = await $.clock.now().catch(() => 0)
  const view: View = { state: runnerStartOf(runner, seed), screen: 'ready', columns: 0, tick: 0 }
  const loop = arcadeLoopOf({
    runner,
    seed,
    clock: { now: () => $.clock.now(), every: (ms, fn) => $.clock.every(ms, fn) },
    isActive: async () => {
      const panes = await $.ui.panes().catch(() => [])
      const pane = panes.find((one) => one.id === ARCADE_PANE)
      if (pane === undefined && arcade?.view === view) {
        // Why here too: a close the ui.close hook never saw still ends the run on its next frame.
        arcade = undefined
      }
      return pane !== undefined && pane.isShown && pane.isFocused
    },
    isHeld,
    draw: (state, screen) => {
      view.state = state
      view.screen = screen
      view.tick += 1
      if (arcade?.view === view && view.columns > 0) {
        void blitArcade($, arcade)
      }
    }
  })
  const own: Arcade = { scene, runner, loop, view }
  arcade = own
  if (isOffer) {
    own.countdown = arcadeCountdownOf({
      seconds: ARCADE_OFFER_SECONDS,
      clock: { every: (ms, fn) => $.clock.every(ms, fn) },
      isHeld,
      draw: (left, held) => {
        view.offer = { left, isHeld: held }
        $.ui.invalidate('ui.render')
      },
      expire: () => {
        if (arcade === own) {
          closePane($)
        }
      }
    })
    raiseTeamEvent($, 'merged', arcadeWords().unlocked)
    clawdReact($, 'level')
  }
  const words = arcadeWords()
  await openPane($, isOffer ? words.offerTitle : words.title, !isOffer || !isHeld())
}

function playOffer($: EngineInterface, own: Arcade): void {
  own.countdown?.stop()
  own.countdown = undefined
  own.view.offer = undefined
  void openPane($, arcadeWords().title, true).catch(() => undefined)
  own.loop.press()
}

export const registerArcade = (on: On): void => {
  on('ui.render', { component: 'Pane', requestId: ARCADE_PANE }, async ($, e) => {
    await ready($)
    const words = arcadeWords()
    const own = arcade
    if (own === undefined || e.surface !== 'terminal') {
      // A pane that outlived its run (a reload) has nothing to play: it closes. Another surface
      // only names it, since closing there would end the terminal's run too.
      if (own === undefined) {
        void $.ui.close({ id: ARCADE_PANE }).catch(() => undefined)
      }
      const { Text } = $.ui.resolve(e)
      return <Text dimColor>{words.title}</Text>
    }
    own.view.columns = Math.max(MIN_COLUMNS, Math.min(MAX_COLUMNS, e.props.bodyColumns))
    const { Box, Button, Raster, Text } = $.ui.resolve(e)
    const close = () => closePane($)
    const raster = (
      <Raster
        key={RASTER_KEY}
        columns={own.view.columns}
        rows={ARCADE_ROWS}
        cells={cellsNow(own)}
      />
    )
    const { offer } = own.view
    if (offer !== undefined) {
      return (
        <Box flexDirection="column">
          {raster}
          <Text key={OFFER_LINE} bold color={offer.isHeld ? 'yellow' : 'green'}>
            {arcadeOfferLineOf(offer.left, offer.isHeld, e.props.isFocused)}
          </Text>
          <Button
            key={PLAY_BUTTON}
            hotkey={ARCADE_JUMP_KEY}
            autoFocus
            onPress={() => playOffer($, own)}
            label={`${ARCADE_JUMP_KEY}: ${words.play}`}
          />
          <Button
            key={PASS_BUTTON}
            hotkey={PASS_KEY}
            onPress={close}
            label={`${PASS_KEY}: ${words.pass}`}
          />
        </Box>
      )
    }
    return (
      <Box flexDirection="column">
        {raster}
        <Button
          key={JUMP_BUTTON}
          hotkey={ARCADE_JUMP_KEY}
          autoFocus
          onPress={() => own.loop.press()}
          label={`${ARCADE_JUMP_KEY}: ${words.jump}`}
        />
        <Button
          key={CLOSE_BUTTON}
          hotkey={CLOSE_KEY}
          onPress={close}
          label={`${CLOSE_KEY}: ${gameStrings().text.close}`}
        />
      </Box>
    )
  })
  on('ui.close', ($, e, next) => {
    if (e.id === ARCADE_PANE) {
      closeArcade()
    }
    return next(e)
  })
}
