import type { EngineInterface, On, RenderElement, RenderInput } from 'claude-code'

import type { ScenePhase } from '../types'

import {
  GAME_COMMANDS,
  QUEST_ALIAS,
  VIEW_COMMAND,
  gameCommandOf,
  type GameCommand
} from './game-commands'
import { activityOf, cardKeyOf, isHumanOrigin, isWorkingNote, noteKey } from './quest-policy'
import {
  headingNameOf,
  headingFitOf,
  headingTimeOf,
  isQuestionToPerson,
  messageHeadingOf,
  toolSummaryOf
} from './message-heading'
import { messageHeadingWords } from './message-heading-words'
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
  type Animated
} from './quest-runtime'
import { gameStrings, localizedNameOf } from './game-strings'
import { sceneColumnsOf } from './scene'
import { forgetFrames, rememberFrame } from './frame-gate'
import { isSceneMode } from './quest-policy'
import { dropScenes } from './flat-toggle'
import { shownSpeaker } from './quest-state'
import { storeHead, storedHeadOf, type MessageHead } from './message-heads'
import { terminalPalette } from './terminal-palette'
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
    // Why: the demo party and the arcade draw in the Team panel; this pane keeps the text.
    if ('arcade' in asked || 'demo' in asked) {
      return { text: text.questInPanel }
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

// Why zen stays hidden: it is the quiet view; on and flat show each step as one dim line.
const isToolLineShown = (): boolean => gameConfig().mode !== 'zen'

function toolLine($: EngineInterface, e: RenderInput, text: string) {
  const { Text } = $.ui.resolve(e)
  return <Text color={terminalPalette().dim}>{`▸ ${text}`}</Text>
}

const registerQuietRows = (on: On) => {
  on('ui.render', { component: 'ToolUse' }, async ($, e, next) => {
    await ready($)
    const { isErrored, isInterrupted, isExpanded, tool, input } = e.props
    if (isOff() || isErrored || isInterrupted || isExpanded === true) {
      return next(e)
    }
    return isToolLineShown() ? toolLine($, e, activityOf(tool, input)) : hidden($, e)
  })
  on('ui.render', { component: 'ToolResult' }, async ($, e, next) => {
    await ready($)
    return isOff() || e.props.isErrored || e.props.isExpanded === true ? next(e) : hidden($, e)
  })
  on('ui.render', { component: 'ToolGroup' }, async ($, e, next) => {
    await ready($)
    const { calls, isExpanded } = e.props
    if (isOff() || isExpanded || calls.some((call) => call.isErrored || call.isInterrupted)) {
      return next(e)
    }
    const summary = toolSummaryOf(calls, messageHeadingWords())
    return isToolLineShown() && summary !== '' ? toolLine($, e, summary) : hidden($, e)
  })
  on('ui.render', { component: 'TurnDuration' }, async ($, e, next) => {
    await ready($)
    return isOff() ? next(e) : hidden($, e)
  })
  // Why: the live line above the prompt says what the spinner did, with whose turn it is.
  on('ui.render', { component: 'Spinner' }, async ($, e, next) => {
    await ready($)
    return isOff() ? next(e) : hidden($, e)
  })
}

// Why no time with no turn seen: a resumed transcript's blocks were written in turns this process never timed.
async function firstHeadOf($: EngineInterface): Promise<{ phase: ScenePhase; time: string }> {
  const turn = quest.turn
  const end = turn?.endedAt ?? (await $.clock.now())
  return {
    phase: shownPhase() ?? 'working',
    time: turn === undefined ? '' : headingTimeOf(end - turn.startedAt)
  }
}

// Why the store first: a resumed session never timed the turns its earlier blocks were written in.
async function headOf($: EngineInterface, key: string): Promise<MessageHead> {
  const stored = await storedHeadOf($, key).catch(() => undefined)
  if (stored !== undefined) {
    return stored
  }
  const head = await firstHeadOf($)
  await storeHead($, key, head).catch(() => undefined)
  return head
}

// Why no frame or padding: a terminal selection copies every cell of the row, border included.
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
    const isQuestion = isQuestionToPerson(e.props.text)
    if (!e.props.isFirstOfReply && !isQuestion) {
      return drawn
    }
    const cardKey = cardKeyOf(e.requestId, e.props.text)
    const head = quest.cardHeads.get(cardKey) ?? (await headOf($, key))
    quest.cardHeads.set(cardKey, head)
    const name = headingNameOf(
      shownSpeaker(),
      localizedNameOf(currentScene().cards[head.phase].name)
    )
    const heading = messageHeadingOf(name, head.phase, isQuestion, messageHeadingWords())
    const fit = headingFitOf(heading, head.time, e.viewport?.columns ?? 80)
    const palette = terminalPalette()
    const { Box, Text } = $.ui.resolve(e)
    // Why a top margin only: an empty row copies as nothing, and it parts the heading from the prompt.
    // Why struck spaces for the rule: a selection copies them as blanks, never as line glyphs.
    return (
      <Box flexDirection="column" marginTop={1}>
        <Box flexDirection="row">
          <Text bold color={isQuestion ? palette.ask : palette.head} wrap="truncate-end">
            {heading}
          </Text>
          {fit.rule === 0 ? null : <Text> </Text>}
          {fit.rule === 0 ? null : (
            <Text color={isQuestion ? palette.askRule : palette.rule} strikethrough>
              {' '.repeat(fit.rule)}
            </Text>
          )}
          {fit.isTimeShown ? <Text color={palette.dim}>{` ${head.time}`}</Text> : null}
        </Box>
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
    // Why not when expanded: ctrl+o shows the line Orca typed, as for any compact row.
    const brief = e.props.isExpanded ? null : briefPathOf(e.props.text)
    if (brief === null) {
      return next(e)
    }
    const { Box, Text } = $.ui.resolve(e)
    return (
      <Box flexDirection="column">
        <Text bold>{`📜 ${gameStrings().text.briefReceived}`}</Text>
        <Text dimColor>{brief}</Text>
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
  registerQuietRows(on)
  registerCards(on)
}
