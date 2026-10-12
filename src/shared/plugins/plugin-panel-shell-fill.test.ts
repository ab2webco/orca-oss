import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  PANEL_DESIGN_TOKEN_ALLOWLIST,
  PANEL_SHELL_COLOR_SCHEME_PLACEHOLDER,
  PANEL_SHELL_TOKENS_PLACEHOLDER,
  PANEL_SHELL_UI_LANGUAGE_PLACEHOLDER,
  buildPluginPanelShellHtml
} from './plugin-panel-shell'
import {
  PANEL_DESIGN_TOKEN_VALUES,
  buildPanelDesignTokenCssFromValues,
  fillPluginPanelShell,
  sanitizePanelUiLanguage
} from './plugin-panel-shell-fill'

function cssBlock(css: string, selector: string): Map<string, string> {
  const start = css.indexOf(`\n${selector} {\n`)
  expect(start).toBeGreaterThan(-1)
  const body = css.slice(start, css.indexOf('\n}\n', start))
  const declarations = new Map<string, string>()
  for (const match of body.matchAll(/(--[\w-]+):\s*([^;]+);/g)) {
    declarations.set(match[1]!, match[2]!.replace(/\s+/g, ' ').trim())
  }
  return declarations
}

describe('fillPluginPanelShell', () => {
  it('fills scheme, language and tokens once, leaving plugin echoes of the placeholders inert', () => {
    const echo = `<p>${PANEL_SHELL_COLOR_SCHEME_PLACEHOLDER} ${PANEL_SHELL_TOKENS_PLACEHOLDER}</p>`
    const html = fillPluginPanelShell(buildPluginPanelShellHtml(echo), {
      colorScheme: 'dark',
      uiLanguage: 'es-CO',
      tokenCss: '--background:#0a0a0a'
    })

    expect(html).toContain('<html class="dark" lang="es-CO">')
    expect(html).toContain(':root{--background:#0a0a0a}')
    expect(html).toContain(echo)
    expect(html).not.toContain(PANEL_SHELL_UI_LANGUAGE_PLACEHOLDER)
  })
})

describe('sanitizePanelUiLanguage', () => {
  it('keeps a BCP 47 tag and falls back to en for anything else', () => {
    expect(sanitizePanelUiLanguage('es')).toBe('es')
    expect(sanitizePanelUiLanguage('pt-BR')).toBe('pt-BR')
    expect(sanitizePanelUiLanguage('en"><script>')).toBe('en')
    expect(sanitizePanelUiLanguage('')).toBe('en')
  })
})

describe('PANEL_DESIGN_TOKEN_VALUES', () => {
  it('matches the desktop light and dark tokens in main.css for every allowlisted token', () => {
    const css = readFileSync(join(process.cwd(), 'src/renderer/src/assets/main.css'), 'utf8')
    const light = cssBlock(css, ':root')
    const dark = new Map([...light, ...cssBlock(css, '.dark')])
    const resolve = (scheme: Map<string, string>, value: string): string =>
      value.replace(/var\((--[\w-]+)\)/g, (_, name: string) => scheme.get(name) ?? '')

    for (const token of PANEL_DESIGN_TOKEN_ALLOWLIST) {
      expect([token, PANEL_DESIGN_TOKEN_VALUES.light[token]]).toEqual([
        token,
        resolve(light, light.get(token) ?? '')
      ])
      expect([token, PANEL_DESIGN_TOKEN_VALUES.dark[token]]).toEqual([
        token,
        resolve(dark, dark.get(token) ?? '')
      ])
    }
  })

  it('builds a declaration for every allowlisted token without structural CSS characters', () => {
    const css = buildPanelDesignTokenCssFromValues(PANEL_DESIGN_TOKEN_VALUES.dark)

    for (const token of PANEL_DESIGN_TOKEN_ALLOWLIST) {
      expect(css).toContain(`${token}:`)
    }
    expect(css).not.toMatch(/[{}<>]/)
    expect(buildPanelDesignTokenCssFromValues({ '--background': 'red;}</style>' })).toBe(
      '--background:red/style'
    )
  })
})
