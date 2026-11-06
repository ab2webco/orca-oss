import type { On, RenderElement } from 'claude-code'

import { readJevAdvisor } from './advisor-state'
import { jevAlertsOf } from './jev-alerts'
import { gameConfig, quest, ready } from './quest-runtime'

// Why named colors: the terminal's own red and yellow read on dark and light themes alike.
const TONE_COLORS = { failure: 'red', warn: 'yellow' } as const

// Core's own band is left out, as the game's band did; another plugin's stays beneath.
const beneathOf = (drawn: RenderElement): RenderElement[] =>
  drawn.type === 'engine' ? [] : [drawn]

/** Above the prompt only Jev's failures, stops and escalations; the team lives in the Team panel. */
export const registerTextLayer = (on: On): void => {
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) {
      return next(e)
    }
    await ready($)
    const config = gameConfig()
    if (config.mode === 'off' || !config.hud) {
      return next(e)
    }
    const [beneath, advisor] = await Promise.all([
      next(e).then(beneathOf),
      readJevAdvisor($, quest.tick)
    ])
    const alerts = jevAlertsOf(advisor)
    const { Box, Text } = $.ui.resolve(e)
    return (
      <Box flexDirection="column">
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
