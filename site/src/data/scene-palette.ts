// The landing's colours, read from the scenes Orca Game ships: night is Quest's handoff sky, day its
// working sky, states are the band's rings. No new colour; tests/landing-palette.test.mjs checks contrast.
import { LEAD_GOLD, STATE_RING } from '../../../resources/claude-plugins/orca-game/hooks/hd-party'
import { SCENES } from '../../../resources/claude-plugins/orca-game/hooks/scenes/index'
import appCss from '../../../src/renderer/src/assets/main.css?raw'

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

type AppTokens = Record<string, string>

// The app's default theme (main.css `:root` light, `.dark` dark), read so the docs cannot drift.
function appTokens(selector: ':root' | '.dark'): AppTokens {
  const start = appCss.indexOf(`\n${selector} {\n`)
  if (start === -1) {
    throw new Error(`main.css has no ${selector} block`)
  }
  const block = appCss.slice(start, appCss.indexOf('\n}', start + 1))
  return Object.fromEntries(
    [...block.matchAll(/^\s*--([\w-]+):\s*([^;]+);/gm)].map((m) => [m[1], m[2]])
  )
}

function declarations(vars: Record<string, string | undefined>): string {
  return Object.entries(vars)
    .map(([name, value]) => {
      if (!value || value.startsWith('var(')) {
        throw new Error(`main.css token for --sl-color-${name} is missing or not a literal`)
      }
      return `--sl-color-${name}:${value};`
    })
    .join('')
}

// Why one mapping for both themes: Starlight's light theme puts its darkest value in white.
const starlightOf = (t: AppTokens, surface: string | undefined, raised: string | undefined) =>
  declarations({
    white: t.foreground,
    'gray-1': t.foreground,
    'gray-2': t.foreground,
    'gray-3': t['muted-foreground'],
    'gray-4': t.ring,
    'gray-5': raised,
    'gray-6': surface,
    'gray-7': surface,
    black: t.background,
    'accent-low': surface,
    accent: t.foreground,
    'accent-high': t.foreground,
    hairline: raised,
    'hairline-light': raised,
    green: t['status-success'],
    'bg-nav': t.background,
    'bg-sidebar': t.background
  })

const dark = appTokens('.dark')
const light = appTokens(':root')

/** Starlight mapped onto the app's default theme: neutral greys, the foreground as the accent. */
export const starlightPaletteCss = [
  `:root{${starlightOf(dark, dark.card, dark.muted)}}`,
  `:root[data-theme='light']{${starlightOf(light, light.secondary, light.border)}}`
].join('')
