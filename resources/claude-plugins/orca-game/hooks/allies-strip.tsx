import { update } from 'claude-code'
import type { EngineInterface, On, RenderElement, RenderInput } from 'claude-code'

import { readJevAdvisor } from './advisor-state'
import {
  allyPartsOf,
  allyRowsOf,
  restyledTextOf,
  withStatus,
  type AllyRow,
  type AllyTone
} from './allies'
import { isAbsorbingConfig } from './game-config'
import { gameStrings } from './game-strings'
import { currentScene, gameConfig, quest, ready } from './quest-runtime'
import type { BandPalette } from './scenes/scene-definition'

const ALLIES = { plugin: 'orca-game', key: 'allies' } as const
const MAX_ALLY_ROWS = 6

export const isAbsorbing = (): boolean => isAbsorbingConfig(gameConfig())

// A tone left out reads in the scene's parchment.
const TONE_COLORS: Readonly<Partial<Record<AllyTone, string>>> = {
  'ci-watching': 'cyan',
  'ci-success': 'green',
  'ci-failure': 'red',
  block: 'red',
  warn: 'yellow'
}

/** Jev and every intercepted status as the strip under the band, or nothing; reading both state values redraws on their writes. A member's strip sits on its pane's colors. */
export async function alliesStrip(
  $: EngineInterface,
  e: RenderInput,
  palette: BandPalette,
  columns: number,
  isPanelShown: boolean,
  isOnPane = false
): Promise<RenderElement[]> {
  if (!isAbsorbing()) {
    return []
  }
  const [advisor, held] = await Promise.all([
    readJevAdvisor($, quest.tick),
    $.state.get(ALLIES).catch(() => ({ value: undefined }))
  ])
  // Why no Jev: the shown Panel's advisor card draws Jev, so the strip keeps only the other plugins' lines.
  const rows = allyRowsOf(isPanelShown ? null : advisor, held.value?.statuses ?? [], {
    isZen: gameConfig().mode === 'zen',
    maxRows: MAX_ALLY_ROWS,
    more: gameStrings().text.moreAllies
  })
  if (rows.length === 0) {
    return []
  }
  const { Box, Text } = $.ui.resolve(e)
  const rowOf = (row: AllyRow) => {
    const parts = allyPartsOf(row, columns)
    return (
      <Box key={row.key} flexDirection="row" overflow="hidden">
        <Text wrap="truncate-end" backgroundColor={isOnPane ? undefined : palette.panel}>
          {parts.label === undefined ? (
            ''
          ) : (
            <Text
              backgroundColor={palette.gold}
              color={palette.ink}
              bold
            >{` ${parts.label} `}</Text>
          )}
          <Text
            color={TONE_COLORS[row.tone] ?? (isOnPane ? undefined : palette.parchment)}
            dimColor={row.tone === 'more'}
          >
            {` ${parts.text}`}
          </Text>
          {parts.badge === undefined ? '' : <Text color={palette.gold}>{` ${parts.badge} `}</Text>}
        </Text>
      </Box>
    )
  }
  return [
    <Box key="allies-strip" flexDirection="column">
      {rows.map(rowOf)}
    </Box>
  ]
}

// Why: a plugin disabled, reloaded or crashed never clears its line; each session starts with none.
export async function clearAllies($: EngineInterface): Promise<void> {
  await $.state.set(ALLIES, { statuses: [] }).catch(() => undefined)
}

export const registerAllies = (on: On): void => {
  // Own calls never reach this hook, so next.origin is always another plugin.
  on('ui.status', async ($, e, next) => {
    await ready($)
    if (!isAbsorbing()) {
      return next(e)
    }
    const plugin = next.origin.plugin
    const isHeld = await update($, ALLIES, (held) => ({
      statuses: withStatus(held?.statuses ?? [], plugin, e.text)
    }))
      .then(() => true)
      .catch(() => false)
    return isHeld ? { value: undefined } : next(e)
  })

  // Resolved once per plugin at load, so the mode and the scene are read when each element is built.
  on('ui.resolve', { component: 'AbovePrompt' }, async ($, e, next) => {
    const table = await next(e)
    if (e.surface !== 'terminal') {
      return table
    }
    const { Box, Text } = table
    return {
      ...table,
      Text: (props: Parameters<typeof Text>[0]) =>
        Text(isAbsorbing() ? restyledTextOf(props, currentScene().band) : props),
      Box: (props: Parameters<typeof Box>[0]) =>
        Box(
          isAbsorbing() && props.borderStyle !== undefined
            ? { ...props, borderColor: currentScene().band.gold }
            : props
        )
    }
  })
}
