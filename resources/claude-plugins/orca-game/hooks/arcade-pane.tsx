import type { EngineInterface, On } from 'claude-code'

import { arcadeCaptionOf, arcadeLoopOf, type ArcadeLoop, type ArcadeScreen } from './arcade-loop'
import { runnerOf, runnerStartOf, type Runner, type RunnerState } from './arcade-runner'
import { ARCADE_RUNNER } from './arcade-runner-data'
import { ARCADE_ROWS, arcadeGridOf, arcadeShapesOf, type ArcadeShape } from './arcade-runner-frame'
import { arcadeWords } from './arcade-words'
import { gameStrings } from './game-strings'
import { cellsOf } from './pixel-canvas'
import { currentScene, ready } from './quest-runtime'
import type { SceneDefinition } from './scenes/index'

// The runner in a pane of its own, opened as the demo's practice run: nothing it scores is kept.

export const ARCADE_PANE = 'orca-game-arcade'
export const ARCADE_JUMP_KEY = 'j'
const RASTER_KEY = 'arcade'
const JUMP_BUTTON = 'arcade-jump'
const CLOSE_BUTTON = 'arcade-close'
// Why a key besides Esc: a phone has none.
const CLOSE_KEY = 'q'
const MIN_COLUMNS = 20
const MAX_COLUMNS = 160

type View = { state: RunnerState; screen: ArcadeScreen; columns: number; tick: number }

type Arcade = {
  scene: SceneDefinition
  runner: Runner<ArcadeShape>
  loop: ArcadeLoop
  view: View
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
      caption: arcadeCaptionOf(view.screen, view.state.score)
    })
  )

const closeArcade = (): void => {
  arcade?.loop.stop()
  arcade = undefined
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

/** Opens the arcade pane on a fresh run of the built-in runner in the active scene. */
export async function openArcade($: EngineInterface): Promise<void> {
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
    draw: (state, screen) => {
      view.state = state
      view.screen = screen
      view.tick += 1
      if (arcade?.view === view && view.columns > 0) {
        void blitArcade($, arcade)
      }
    }
  })
  arcade = { scene, runner, loop, view }
  await $.ui.open({
    id: ARCADE_PANE,
    title: arcadeWords().title,
    closeOnEscape: true,
    focus: true
  })
}

export const registerArcade = (on: On): void => {
  on('ui.render', { component: 'Pane', requestId: ARCADE_PANE }, async ($, e) => {
    await ready($)
    const words = arcadeWords()
    const own = arcade
    if (own === undefined || e.surface !== 'terminal') {
      // A pane that outlived its run (a reload) has nothing to play: it closes.
      void $.ui.close({ id: ARCADE_PANE }).catch(() => undefined)
      const { Text } = $.ui.resolve(e)
      return <Text dimColor>{words.title}</Text>
    }
    own.view.columns = Math.max(MIN_COLUMNS, Math.min(MAX_COLUMNS, e.props.bodyColumns))
    const { Box, Button, Raster } = $.ui.resolve(e)
    const close = () => {
      closeArcade()
      void $.ui.close({ id: ARCADE_PANE }).catch(() => undefined)
    }
    return (
      <Box flexDirection="column">
        <Raster
          key={RASTER_KEY}
          columns={own.view.columns}
          rows={ARCADE_ROWS}
          cells={cellsNow(own)}
        />
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
