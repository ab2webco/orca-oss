// The landing's colours, read from the scenes Orca Game ships: night is Quest's handoff sky, day its
// working sky, states are the band's rings. No new colour; tests/landing-palette.test.mjs checks contrast.
import { LEAD_GOLD, STATE_RING } from '../../../resources/claude-plugins/orca-game/hooks/hd-party'
import { SCENES } from '../../../resources/claude-plugins/orca-game/hooks/scenes/index'

const hex = (color: number): string => `#${color.toString(16).padStart(6, '0')}`

const quest = SCENES.quest?.looks
const tamer = SCENES.tamer?.looks
const jrpg = SCENES.jrpg?.looks
if (!quest || !tamer || !jrpg) {
  throw new Error('the Quest, Tamer and JRPG scenes are missing from the game')
}

const night = {
  bg: quest.handoff.skyTop,
  surface: quest.handoff.far,
  line: quest.handoff.cloud,
  fg: quest.working.snow,
  muted: quest.handoff.snow,
  link: quest.working.sun,
  gold: LEAD_GOLD,
  working: STATE_RING.working,
  waiting: STATE_RING.waiting,
  done: tamer.working.near
}

const day = {
  bg: quest.working.cloud,
  surface: quest.build.snow,
  line: quest.working.skyBottom,
  fg: quest.handoff.skyTop,
  muted: quest.docs.skyTop,
  link: quest.working.plant,
  gold: quest.docs.ground,
  working: jrpg.working.skyTop,
  waiting: jrpg.verify.skyBottom,
  done: quest.build.plant
}

export type PaletteRole = keyof typeof night

const declarationsOf = (palette: Record<PaletteRole, number>): string =>
  Object.entries(palette)
    .map(([role, color]) => `--scene-${role}:${hex(color)};`)
    .join('')

/** CSS for both themes; the theme attribute matches Starlight's picker. */
export const scenePaletteCss = [
  `:root{${declarationsOf(night)}color-scheme:dark;}`,
  `:root[data-theme='light']{${declarationsOf(day)}color-scheme:light;}`
].join('')

// Why one mapping for both themes: Starlight's light theme already puts its darkest value in --sl-color-white.
const starlightOf = (palette: Record<PaletteRole, number>, accent: PaletteRole): string =>
  Object.entries({
    white: palette.fg,
    'gray-1': palette.fg,
    'gray-2': palette.muted,
    'gray-3': palette.muted,
    'gray-4': palette.line,
    'gray-5': palette.line,
    'gray-6': palette.surface,
    'gray-7': palette.surface,
    black: palette.bg,
    'accent-low': palette.surface,
    accent: palette[accent],
    'accent-high': palette.link
  })
    .map(([name, color]) => `--sl-color-${name}:${hex(color)};`)
    .join('')

/** The same palette for the Starlight docs, mapped onto its gray scale and accent. */
export const starlightPaletteCss = [
  `:root{${starlightOf(night, 'gold')}}`,
  `:root[data-theme='light']{${starlightOf(day, 'link')}}`
].join('')
