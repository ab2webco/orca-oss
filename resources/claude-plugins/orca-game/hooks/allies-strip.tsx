import { update } from 'claude-code'
import type { EngineInterface, On, RenderElement, RenderInput } from 'claude-code'

import {
  advisorOf,
  allyRowsOf,
  restyledTextOf,
  withStatus,
  type AllyRow,
  type AllyTone
} from './allies'
import { gameStrings } from './game-strings'
import { currentScene, gameConfig, ready } from './quest-runtime'
import type { BandPalette } from './scenes/scene-definition'

const ALLIES = { plugin: 'orca-game', key: 'allies' } as const
const JEV_ADVISOR = { plugin: 'orca-jev-mod-skills', key: 'advisor' } as const
const MAX_ALLY_ROWS = 6

/** The game draws what other plugins show only while it is on screen: a mode and its band. */
export const isAbsorbing = (): boolean => {
  const config = gameConfig()
  return config.mode !== 'off' && config.hud
}

// A tone left out reads in the scene's parchment.
const TONE_COLORS: Readonly<Partial<Record<AllyTone, string>>> = {
  'ci-watching': 'cyan',
  'ci-success': 'green',
  'ci-failure': 'red',
  block: 'red',
  warn: 'yellow'
}

/** Jev and every intercepted status, as rows under the band; reading both state values redraws on their writes. */
export async function alliesStrip(
  $: EngineInterface,
  e: RenderInput,
  palette: BandPalette,
  columns: number
): Promise<RenderElement | undefined> {
  if (!isAbsorbing()) {
    return undefined
  }
  const [jev, held] = await Promise.all([
    $.state.get(JEV_ADVISOR).catch(() => ({ value: undefined })),
    $.state.get(ALLIES).catch(() => ({ value: undefined }))
  ])
  const rows = allyRowsOf(advisorOf(jev.value), held.value?.statuses ?? [], {
    isZen: gameConfig().mode === 'zen',
    maxRows: MAX_ALLY_ROWS,
    more: gameStrings().text.moreAllies
  })
  if (rows.length === 0) {
    return undefined
  }
  const { Box, Text } = $.ui.resolve(e)
  // Why the slice: a status can be any length, and truncate-end alone still measures all of it.
  const fit = (text: string) => text.slice(0, columns)
  const rowOf = (row: AllyRow) => (
    <Box key={row.key} flexDirection="row" overflow="hidden">
      <Text wrap="truncate-end" backgroundColor={palette.panel}>
        {row.label === undefined ? (
          ''
        ) : (
          <Text
            backgroundColor={palette.gold}
            color={palette.ink}
            bold
          >{` ${fit(row.label)} `}</Text>
        )}
        <Text color={TONE_COLORS[row.tone] ?? palette.parchment} dimColor={row.tone === 'more'}>
          {` ${fit(row.text)}`}
        </Text>
        {row.badge === undefined ? '' : <Text color={palette.gold}>{` ${fit(row.badge)} `}</Text>}
      </Text>
    </Box>
  )
  return <Box flexDirection="column">{rows.map(rowOf)}</Box>
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
