import type { EngineInterface, RenderElement, RenderInput } from 'claude-code'

import { advisorSpriteOf } from './advisor-art'
import { advisorCardOf } from './advisor-card-rows'
import { advisorLogOf, readJevAdvisor } from './advisor-state'
import { isAbsorbingConfig } from './game-config'
import { gameStrings } from './game-strings'
import { currentScene, gameConfig, quest } from './quest-runtime'
import type { AdvisorGesture, BandPalette } from './scenes/scene-definition'

// A gesture left out reads in the scene's parchment.
const GESTURE_COLORS: Readonly<Partial<Record<AdvisorGesture, string>>> = {
  lowered: 'green',
  raised: 'yellow',
  unsure: 'yellow',
  escalated: 'red',
  ciPassed: 'green',
  ciFailed: 'red',
  ciRunning: 'cyan'
}

/** The Panel's card for Jev's advisor; none while Jev publishes nothing or draws its own band. */
export async function advisorCard(
  $: EngineInterface,
  e: RenderInput,
  palette: BandPalette
): Promise<RenderElement | null> {
  if (!isAbsorbingConfig(gameConfig())) {
    return null
  }
  const [advisor, log] = await Promise.all([readJevAdvisor($, quest.tick), advisorLogOf($)])
  if (advisor === null) {
    return null
  }
  const card = advisorCardOf(advisorSpriteOf(currentScene()), advisor, log.decisions)
  const { Box, Text } = $.ui.resolve(e)
  return (
    <Box
      key="advisor-card"
      flexDirection="column"
      borderStyle="round"
      borderColor={palette.gold}
      paddingX={1}
    >
      <Box flexDirection="row" gap={1}>
        <Text color={palette.gold} bold>{`◆ ${card.name}`}</Text>
        {card.badge === '' ? <Box /> : <Text color={palette.parchment}>{card.badge}</Text>}
        {card.line === null ? (
          <Box />
        ) : (
          <Text dimColor wrap="truncate-end">
            {card.line}
          </Text>
        )}
      </Box>
      {card.rows.length === 0 ? (
        <Text dimColor>{gameStrings().text.advisorEmpty}</Text>
      ) : (
        card.rows.map((row) => (
          <Text
            key={`advisor-${row.key}`}
            color={
              (row.gesture === null ? undefined : GESTURE_COLORS[row.gesture]) ?? palette.parchment
            }
            wrap="truncate-end"
          >
            {row.text}
          </Text>
        ))
      )}
    </Box>
  )
}
