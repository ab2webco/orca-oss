import type { EngineInterface, RenderElement, RenderInput } from 'claude-code'

import { advisorSpriteOf } from './advisor-art'
import { advisorCardOf, type AdvisorCard, type AdvisorCardContext } from './advisor-card-rows'
import { advisorLogOf, readJevAdvisor } from './advisor-state'
import { ADVISOR_TILE_KEY, advisorTileCellsOf } from './advisor-tile'
import { TILE_COLUMNS, TILE_ROWS } from './fleet-tiles'
import { isAbsorbingConfig } from './game-config'
import { gameStrings } from './game-strings'
import { currentScene, gameConfig, quest, type Animated } from './quest-runtime'
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

export type AdvisorCardView = { card: AdvisorCard; tile: Animated }

/** What the Panel's advisor card shows; none while Jev publishes nothing or draws its own band. */
export async function advisorCardViewOf(
  $: EngineInterface,
  context: AdvisorCardContext
): Promise<AdvisorCardView | null> {
  if (!isAbsorbingConfig(gameConfig())) {
    return null
  }
  const [advisor, log] = await Promise.all([readJevAdvisor($, quest.tick), advisorLogOf($)])
  if (advisor === null) {
    return null
  }
  const sprite = advisorSpriteOf(currentScene())
  const card = advisorCardOf(sprite, advisor, log.decisions, context)
  const tile: Animated = {
    key: ADVISOR_TILE_KEY,
    columns: TILE_COLUMNS,
    rows: TILE_ROWS,
    draw: (at: number) => advisorTileCellsOf(sprite, card.pose, at)
  }
  return { card, tile }
}

/** The card itself, laid out as a member card: the tile on the left, the text beside it, wrapped. */
export function advisorCard(
  $: EngineInterface,
  e: RenderInput,
  palette: BandPalette,
  card: AdvisorCard,
  tile?: RenderElement
): RenderElement {
  const { Box, Text } = $.ui.resolve(e)
  return (
    <Box key="advisor-card" flexDirection="row" borderStyle="round" borderColor={palette.gold}>
      {tile ?? <Box width={TILE_COLUMNS} />}
      <Box flexDirection="column" paddingLeft={1} flexGrow={1} flexShrink={1}>
        <Text color={palette.gold} bold wrap="wrap">{`◆ ${card.name}`}</Text>
        {card.line === null ? (
          <Box />
        ) : (
          <Text dimColor wrap="wrap">
            {card.line}
          </Text>
        )}
        {card.rows.length === 0 ? (
          <Text dimColor>{gameStrings().text.advisorEmpty}</Text>
        ) : (
          card.rows.map((row) => (
            <Text
              key={`advisor-${row.key}`}
              color={
                (row.gesture === null ? undefined : GESTURE_COLORS[row.gesture]) ??
                palette.parchment
              }
              wrap="wrap"
            >
              {row.text}
            </Text>
          ))
        )}
      </Box>
    </Box>
  )
}
