// The landing's and the docs' colours, read from the app's default theme (main.css), so neither can
// drift from the editor. No new colour; tests/landing-palette.test.mjs checks contrast and origin.
import appCss from '../../../src/renderer/src/assets/main.css?raw'

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

// Why roles over raw tokens: the landing names what a colour does; green is for success only.
const landingOf = (t: AppTokens, surface: string | undefined, raised: string | undefined) => {
  const roles: Record<string, string | undefined> = {
    bg: t.background,
    surface,
    raised,
    line: raised,
    fg: t.foreground,
    'fg-2': t['secondary-foreground'],
    muted: t['muted-foreground'],
    success: t['status-success']
  }
  return Object.entries(roles)
    .map(([role, value]) => {
      if (!value || value.startsWith('var(')) {
        throw new Error(`main.css token for --scene-${role} is missing or not a literal`)
      }
      return `--scene-${role}:${value};`
    })
    .join('')
}

/** The landing's palette for both themes; the theme attribute matches Starlight's picker. */
export const scenePaletteCss = [
  `:root{${landingOf(dark, dark.card, dark.secondary)}color-scheme:dark;}`,
  `:root[data-theme='light']{${landingOf(light, light.secondary, light.border)}color-scheme:light;}`
].join('')

/** Starlight mapped onto the app's default theme: neutral greys, the foreground as the accent. */
export const starlightPaletteCss = [
  `:root{${starlightOf(dark, dark.card, dark.muted)}}`,
  `:root[data-theme='light']{${starlightOf(light, light.secondary, light.border)}}`
].join('')
