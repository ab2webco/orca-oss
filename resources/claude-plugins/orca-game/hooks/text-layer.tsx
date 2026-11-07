import type { EngineInterface, On, RenderElement, RenderInput } from 'claude-code'

import { readJevAdvisor } from './advisor-state'
import { cellWidthOf, fitCells } from './cell-width'
import { localizedNameOf } from './game-strings'
import { jevAlertsOf } from './jev-alerts'
import { liveLineOf, liveStatusOf, type LiveState } from './live-line'
import { LIVE_EVERY_TICKS, readLiveBeat } from './live-turn'
import { headingNameOf } from './message-heading'
import { messageHeadingWords } from './message-heading-words'
import { currentScene, gameConfig, quest, ready, shownPhase } from './quest-runtime'
import { shownSpeaker } from './quest-state'

// Why named colors: the terminal's own red, yellow and green read on dark and light themes alike.
const TONE_COLORS = { failure: 'red', warn: 'yellow' } as const
const LIVE_COLORS: Readonly<Record<LiveState, string | undefined>> = {
  working: undefined,
  waiting: 'red',
  done: 'green'
}

// Core's own band is left out, as the game's band did; another plugin's stays beneath.
const beneathOf = (drawn: RenderElement): RenderElement[] =>
  drawn.type === 'engine' ? [] : [drawn]

async function liveRow(
  $: EngineInterface,
  e: RenderInput<'AbovePrompt'>
): Promise<RenderElement | null> {
  await readLiveBeat($)
  const turn = quest.turn
  if (turn === undefined || e.props.view.agentId !== undefined) {
    return null
  }
  const status = liveStatusOf(turn, await $.clock.now())
  const phase = shownPhase() ?? 'working'
  const name = headingNameOf(shownSpeaker(), localizedNameOf(currentScene().cards[phase].name))
  const line = liveLineOf(
    {
      state: status.state,
      name,
      phase,
      elapsedMs: status.elapsedMs,
      step: status.step ?? quest.caption,
      frame: Math.floor(quest.tick / LIVE_EVERY_TICKS)
    },
    messageHeadingWords()
  )
  const color = LIVE_COLORS[status.state]
  const head = ` ${line.verb} ${line.time}`
  const room = e.props.bodyColumns - cellWidthOf(`${line.glyph} ${line.name}${head} · `)
  const { Box, Text } = $.ui.resolve(e)
  return (
    <Box flexDirection="row">
      <Text color={color}>{line.glyph}</Text>
      <Text> </Text>
      <Text bold color={color}>
        {line.name}
      </Text>
      <Text dimColor>{head}</Text>
      {line.step === '' || room < 4 ? null : (
        <Text dimColor wrap="truncate-end">{` · ${fitCells(line.step, room)}`}</Text>
      )}
    </Box>
  )
}

/** Above the prompt the live line, then Jev's failures, stops and escalations; the team lives in the Team panel. */
export const registerTextLayer = (on: On): void => {
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) {
      return next(e)
    }
    await ready($)
    const config = gameConfig()
    if (config.mode === 'off') {
      return next(e)
    }
    const [beneath, advisor, live] = await Promise.all([
      config.hud ? next(e).then(beneathOf) : next(e).then((drawn) => [drawn]),
      config.hud ? readJevAdvisor($, quest.tick) : Promise.resolve(null),
      liveRow($, e)
    ])
    const alerts = jevAlertsOf(advisor)
    const { Box, Text } = $.ui.resolve(e)
    return (
      <Box flexDirection="column">
        {live}
        {alerts.map((alert) => (
          <Text key={alert.key} color={TONE_COLORS[alert.tone]} wrap="truncate-end">
            {`Jev · ${alert.text}`}
          </Text>
        ))}
        {beneath}
      </Box>
    )
  })
}
