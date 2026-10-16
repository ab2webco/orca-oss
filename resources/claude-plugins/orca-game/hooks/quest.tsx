import type { EngineInterface, On, RenderElement, RenderInput } from 'claude-code'

import { cardKeyOf, isHumanOrigin, isWorkingNote, noteKey, questCommandOf } from './quest-policy'
import {
  currentScene,
  gameConfig,
  quest,
  ready,
  resetQuest,
  shownPhase,
  spinnerCellsOf,
  startDemo,
  type Animated
} from './quest-runtime'
import { SCENE_KEY, sceneColumnsOf } from './scene'

const MODES_HELP =
  '/quest off shows everything, /quest on hides tool rows, /quest zen also hides working notes, /quest demo plays a scripted fake party.'

const isOff = (): boolean => gameConfig().mode === 'off'

function hidden($: EngineInterface, e: RenderInput) {
  const { Box } = $.ui.resolve(e)
  return <Box display="none" />
}

export async function animate(
  $: EngineInterface,
  e: RenderInput,
  items: readonly Animated[]
): Promise<Map<string, RenderElement>> {
  await ready($)
  if (isOff() || e.surface !== 'terminal' || items.length === 0) {
    quest.animations.delete(e.requestId)
    return new Map()
  }
  quest.animations.set(e.requestId, items)
  const { Raster } = $.ui.resolve(e)
  return new Map(
    items.map((item) => [
      item.key,
      <Raster
        key={item.key}
        columns={item.columns}
        rows={item.rows}
        cells={item.draw(quest.tick)}
      />
    ])
  )
}

export const fleetColumnsOf = (e: RenderInput): number => sceneColumnsOf(e.viewport?.columns)

export async function questSessionStart($: EngineInterface): Promise<void> {
  resetQuest()
  await ready($)
  await $.command
    .register({
      name: 'quest',
      description:
        'Quest mode: an animated Claude, character cards per flow phase, quiet tool rows',
      argumentHint: '[off|on|zen|demo]',
      immediate: true
    })
    .catch(() => undefined)
}

const registerCommand = (on: On) => {
  on('command.run', { command: 'quest' }, async ($, e) => {
    await ready($)
    const asked = questCommandOf(e.args)
    if ('error' in asked) {
      return { text: asked.error }
    }
    if ('show' in asked) {
      return { text: `Quest: ${quest.isDemo ? 'demo' : gameConfig().mode}. ${MODES_HELP}` }
    }
    if ('demo' in asked) {
      startDemo()
      $.ui.invalidate('ui.render')
      return {
        text: 'Quest: demo. A scripted fake party plays every reaction; nothing is read or written. /quest on returns to real data.'
      }
    }
    quest.isDemo = false
    quest.modeOverride = asked.mode
    if (asked.mode === 'off') {
      quest.stages.clear()
    }
    $.ui.invalidate('ui.render')
    return { text: `Quest: ${asked.mode}.` }
  })
}

// Zen hides short notes written between tool calls; this learns which text was one.
const registerNotes = (on: On) => {
  on('turn.step', async function* ($, e, next) {
    const stream = next(e)
    const blocks = new Map<number, string>()
    for await (const chunk of stream) {
      if (chunk.kind === 'text') {
        blocks.set(chunk.index, (blocks.get(chunk.index) ?? '') + chunk.text)
      }
      yield chunk
    }
    const result = await stream.result
    if (e.agentId !== undefined) {
      return result
    }
    let isChanged = false
    for (const text of [...blocks.values(), result.answer]) {
      const key = noteKey(text)
      if (key === '') {
        continue
      }
      if (isWorkingNote(result, text)) {
        if (!quest.replies.has(key) && !quest.notes.has(key)) {
          quest.notes.add(key)
          isChanged = true
        }
        continue
      }
      if (!quest.replies.has(key)) {
        quest.replies.add(key)
        isChanged = true
      }
      isChanged = quest.notes.delete(key) || isChanged
    }
    if (isChanged && gameConfig().mode === 'zen') {
      $.ui.invalidate('ui.render')
    }
    return result
  })
}

const registerSpinner = (on: On) => {
  on('ui.render', { component: 'Spinner' }, async ($, e, next) => {
    await ready($)
    if (isOff() || e.surface !== 'terminal') {
      quest.stages.delete(e.requestId)
      return next(e)
    }
    const columns = sceneColumnsOf(e.viewport?.columns)
    const packed = spinnerCellsOf(columns)
    quest.stages.set(e.requestId, { columns, rows: packed.rows })
    const spinner = await next(e)
    const { Box, Raster } = $.ui.resolve(e)
    return (
      <Box flexDirection="column">
        <Raster key={SCENE_KEY} columns={columns} rows={packed.rows} cells={packed.cells} />
        {spinner}
      </Box>
    )
  })
}

const registerQuietRows = (on: On) => {
  on('ui.render', { component: 'ToolUse' }, async ($, e, next) => {
    await ready($)
    if (isOff() || e.props.isErrored || e.props.isInterrupted) {
      return next(e)
    }
    return hidden($, e)
  })
  on('ui.render', { component: 'ToolResult' }, async ($, e, next) => {
    await ready($)
    return isOff() || e.props.isErrored ? next(e) : hidden($, e)
  })
  on('ui.render', { component: 'ToolGroup' }, async ($, e, next) => {
    await ready($)
    if (isOff() || e.props.calls.some((call) => call.isErrored)) {
      return next(e)
    }
    return hidden($, e)
  })
  on('ui.render', { component: 'TurnDuration' }, async ($, e, next) => {
    await ready($)
    return isOff() ? next(e) : hidden($, e)
  })
}

const registerCards = (on: On) => {
  on('ui.render', { component: 'AssistantMessage' }, async ($, e, next) => {
    await ready($)
    const key = noteKey(e.props.text)
    const isNote = quest.notes.has(key) && !quest.replies.has(key)
    if (gameConfig().mode === 'zen' && isNote) {
      return hidden($, e)
    }
    const drawn = await next(e)
    if (isOff() || key === '') {
      return drawn
    }
    // A card keeps the phase it was first drawn in, so scrolling back never repaints it.
    const cardKey = cardKeyOf(e.requestId, e.props.text)
    if (!quest.cardPhases.has(cardKey)) {
      quest.cardPhases.set(cardKey, shownPhase() ?? 'working')
    }
    const card = currentScene().cards[quest.cardPhases.get(cardKey) ?? 'working']
    const { Box, Text } = $.ui.resolve(e)
    return (
      <Box flexDirection="column" borderStyle="round" borderColor={card.color} paddingX={1}>
        {e.props.isFirstOfReply ? (
          <Text bold color={card.color}>{`${card.icon} ${card.name}`}</Text>
        ) : (
          <Box />
        )}
        {drawn}
      </Box>
    )
  })
  on('ui.render', { component: 'UserMessage' }, async ($, e, next) => {
    await ready($)
    if (isOff()) {
      return next(e)
    }
    if (!isHumanOrigin(e.props.origin.kind)) {
      return hidden($, e)
    }
    const drawn = await next(e)
    const teller = currentScene().teller
    const { Box, Text } = $.ui.resolve(e)
    return (
      <Box flexDirection="column" borderStyle="round" borderColor={teller.color} paddingX={1}>
        <Text bold color={teller.color}>{`${teller.icon} ${teller.name}`}</Text>
        {drawn}
      </Box>
    )
  })
}

export const registerQuest = (on: On): void => {
  registerCommand(on)
  registerNotes(on)
  registerSpinner(on)
  registerQuietRows(on)
  registerCards(on)
}
