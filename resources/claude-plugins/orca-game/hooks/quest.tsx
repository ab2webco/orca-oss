import type { EngineInterface, On, RenderElement, RenderInput } from 'claude-code'

import {
  GAME_COMMANDS,
  QUEST_ALIAS,
  VIEW_COMMAND,
  gameCommandOf,
  type GameCommand
} from './game-commands'
import { cardKeyOf, isHumanOrigin, isWorkingNote, noteKey } from './quest-policy'
import { briefPathOf } from './brief-line'
import {
  configuredConfig,
  currentScene,
  gameConfig,
  publishAbsorbing,
  quest,
  ready,
  resetQuest,
  shownPhase,
  stageCellsOf,
  stageOf,
  startDemo,
  type Animated
} from './quest-runtime'
import { gameStrings, localizedNameOf } from './game-strings'
import { SCENE_KEY, sceneColumnsOf } from './scene'
import { forgetFrames, rememberFrame } from './frame-gate'
import { isSceneMode } from './quest-policy'
import { openArcade } from './arcade-pane'
import { arcadeWords } from './arcade-words'
import { flatLine } from './flat-block'
import { dropScenes } from './flat-toggle'
import { flatPhaseLineOf } from './flat-view'
import { isMemberBandCollapsed } from './member-pane'
import { shownCaption } from './quest-state'
import { viewCommandOf, viewListOf } from './view-command'
import { currentView, switchView, viewChoicesOf } from './view-switch'

const isOff = (): boolean => gameConfig().mode === 'off'
const isSceneDrawn = (): boolean => isSceneMode(gameConfig().mode)

// Why: `game state` knows only Orca's layers, so a /quest value it does not report says it is this pane's.
const shownSetting = (key: 'mode' | 'render'): string => {
  const value = gameConfig()[key]
  const configured = configuredConfig()[key]
  return value === configured
    ? value
    : gameStrings().text.sessionOverride(value, configured, quest.liveSources[key])
}

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
  if (!isSceneDrawn() || e.surface !== 'terminal' || items.length === 0) {
    quest.animations.delete(e.requestId)
    forgetFrames(e.requestId)
    return new Map()
  }
  quest.animations.set(e.requestId, items)
  const { Raster } = $.ui.resolve(e)
  return new Map(
    items.map((item) => {
      const cells = item.draw(quest.tick)
      rememberFrame(e.requestId, item.key, cells)
      return [
        item.key,
        <Raster key={item.key} columns={item.columns} rows={item.rows} cells={cells} />
      ]
    })
  )
}

export const fleetColumnsOf = (e: RenderInput): number => sceneColumnsOf(e.viewport?.columns)

export async function questSessionStart($: EngineInterface): Promise<void> {
  resetQuest()
  await ready($)
  await $.command
    .register({
      name: QUEST_ALIAS,
      description: gameStrings().text.questDescription,
      argumentHint: '[off|on|zen|flat|demo|demo arcade|demo offer|render classic|hd|hd-compact]',
      immediate: true
    })
    .catch(() => undefined)
}

const registerCommand = (on: On, command: GameCommand) => {
  on('command.run', { command }, async ($, e) => {
    await ready($)
    const asked = gameCommandOf(command, e.args)
    const text = gameStrings().text
    if ('error' in asked) {
      return { text: asked.error }
    }
    if ('show' in asked) {
      const mode = quest.isDemo ? 'demo' : shownSetting('mode')
      const render = text.questRenderShown(shownSetting('render'))
      return { text: `${text.questShown(mode)} ${render} ${text.questModesHelp}` }
    }
    if ('render' in asked) {
      quest.renderOverride = asked.render
      $.ui.invalidate('ui.render')
      return { text: text.questRenderShown(shownSetting('render')) }
    }
    if ('arcade' in asked) {
      await openArcade($, asked.isOffer === true)
      return { text: asked.isOffer === true ? arcadeWords().offered : arcadeWords().opened }
    }
    if ('demo' in asked) {
      startDemo()
      $.ui.invalidate('ui.render')
      await publishAbsorbing($)
      return { text: text.questDemo }
    }
    quest.isDemo = false
    quest.modeOverride = asked.mode
    if (!isSceneMode(asked.mode)) {
      dropScenes()
    }
    $.ui.invalidate('ui.render')
    await publishAbsorbing($)
    return { text: text.questShown(shownSetting('mode')) }
  })
}

const registerView = (on: On) => {
  on('command.run', { command: VIEW_COMMAND }, async ($, e) => {
    await ready($)
    const asked = viewCommandOf(e.args)
    if ('error' in asked) {
      return { text: asked.error }
    }
    if ('list' in asked) {
      const { scopes, suggested } = await viewChoicesOf($)
      return { text: viewListOf(currentView(), suggested, scopes) }
    }
    return { text: await switchView($, asked.view, asked.scope) }
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
    // Why: a member who collapsed its band asked for Claude's own spinner, with no scene above it.
    const isCollapsed = isMemberBandCollapsed()
    if (isCollapsed || !isSceneDrawn() || e.surface !== 'terminal') {
      quest.stages.delete(e.requestId)
      forgetFrames(e.requestId)
      if (isCollapsed || isOff() || e.surface !== 'terminal') {
        return next(e)
      }
      // Flat keeps what the hero shows, the phase's card and the caption, as one line of text.
      const scene = currentScene()
      const columns = sceneColumnsOf(e.viewport?.columns)
      const line = flatPhaseLineOf(scene, shownPhase(), shownCaption(), columns)
      const spinner = await next(e)
      const { Box } = $.ui.resolve(e)
      return (
        <Box flexDirection="column">
          {flatLine($, e, line, scene.band)}
          {spinner}
        </Box>
      )
    }
    const stage = stageOf(sceneColumnsOf(e.viewport?.columns), e.viewport?.rows)
    quest.stages.set(e.requestId, stage)
    const cells = stageCellsOf(stage)
    rememberFrame(e.requestId, SCENE_KEY, cells)
    const spinner = await next(e)
    const { Box, Raster } = $.ui.resolve(e)
    return (
      <Box flexDirection="column">
        <Raster key={SCENE_KEY} columns={stage.columns} rows={stage.rows} cells={cells} />
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
          <Text bold color={card.color}>{`${card.icon} ${localizedNameOf(card.name)}`}</Text>
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
    const teller = currentScene().teller
    const { Box, Text } = $.ui.resolve(e)
    // Why not when expanded: ctrl+o shows the line Orca typed, as for any compact row.
    const brief = e.props.isExpanded ? null : briefPathOf(e.props.text)
    if (brief !== null) {
      return (
        <Box flexDirection="column" borderStyle="round" borderColor={teller.color} paddingX={1}>
          <Text bold color={teller.color}>{`📜 ${gameStrings().text.briefReceived}`}</Text>
          <Text dimColor>{brief}</Text>
        </Box>
      )
    }
    const drawn = await next(e)
    return (
      <Box flexDirection="column" borderStyle="round" borderColor={teller.color} paddingX={1}>
        <Text bold color={teller.color}>{`${teller.icon} ${localizedNameOf(teller.name)}`}</Text>
        {drawn}
      </Box>
    )
  })
}

export const registerQuest = (on: On): void => {
  const commands: readonly GameCommand[] = [QUEST_ALIAS, ...GAME_COMMANDS]
  for (const command of commands) {
    registerCommand(on, command)
  }
  registerView(on)
  registerNotes(on)
  registerSpinner(on)
  registerQuietRows(on)
  registerCards(on)
}
