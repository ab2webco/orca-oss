import {
  type PANEL_DESIGN_TOKEN_ALLOWLIST,
  PANEL_SHELL_COLOR_SCHEME_PLACEHOLDER,
  PANEL_SHELL_TOKENS_PLACEHOLDER,
  PANEL_SHELL_UI_LANGUAGE_PLACEHOLDER
} from './plugin-panel-shell'

export type PanelColorScheme = 'light' | 'dark'

export type PanelDesignToken = (typeof PANEL_DESIGN_TOKEN_ALLOWLIST)[number]

export type PanelShellFill = {
  colorScheme: PanelColorScheme
  uiLanguage: string
  tokenCss: string
}

/** Fills the shell placeholders main cannot know. First-occurrence replace: the
 *  prelude parses before any plugin content, so a plugin echoing the
 *  placeholder string is inert. */
export function fillPluginPanelShell(html: string, fill: PanelShellFill): string {
  return html
    .replace(PANEL_SHELL_COLOR_SCHEME_PLACEHOLDER, fill.colorScheme)
    .replace(PANEL_SHELL_UI_LANGUAGE_PLACEHOLDER, sanitizePanelUiLanguage(fill.uiLanguage))
    .replace(PANEL_SHELL_TOKENS_PLACEHOLDER, fill.tokenCss)
}

/** What a `lang` attribute may hold; anything else falls back to `en`. */
export function sanitizePanelUiLanguage(language: string): string {
  return /^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$/.test(language) ? language : 'en'
}

/** Values are still stripped of structural CSS characters before landing
 *  inside the shell's <style> block. */
export function buildPanelDesignTokenCssFromValues(
  values: Partial<Record<string, string>>
): string {
  const declarations: string[] = []
  for (const [token, raw] of Object.entries(values)) {
    const value = raw?.trim() ?? ''
    if (value.length > 0) {
      declarations.push(`${token}:${value.replaceAll(/[{}<>;]/g, '')}`)
    }
  }
  return declarations.join(';')
}

const SANS = "'Geist', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
const MONO =
  "'SF Mono', SFMono-Regular, ui-monospace, 'Cascadia Code', Menlo, Consolas, 'Liberation Mono', monospace"

/** Static copy of the desktop tokens for hosts without the app's stylesheet
 *  (the mobile WebView). Held equal to main.css by plugin-panel-shell-fill.test. */
export const PANEL_DESIGN_TOKEN_VALUES: Record<
  PanelColorScheme,
  Record<PanelDesignToken, string>
> = {
  light: {
    '--background': '#fff',
    '--foreground': '#0a0a0a',
    '--card': '#fff',
    '--card-foreground': '#0a0a0a',
    '--popover': '#fff',
    '--popover-foreground': '#0a0a0a',
    '--primary': '#171717',
    '--primary-foreground': '#fafafa',
    '--secondary': '#f5f5f5',
    '--secondary-foreground': '#171717',
    '--muted': '#f5f5f5',
    '--muted-foreground': '#737373',
    '--accent': '#f5f5f5',
    '--accent-foreground': '#171717',
    '--destructive': '#e40014',
    '--destructive-foreground': '#fcf3f3',
    '--border': '#e5e5e5',
    '--input': '#e5e5e5',
    '--ring': '#a1a1a1',
    '--radius': '0.625rem',
    '--font-sans': SANS,
    '--font-mono': MONO
  },
  dark: {
    '--background': '#0a0a0a',
    '--foreground': '#fafafa',
    '--card': '#171717',
    '--card-foreground': '#fafafa',
    '--popover': '#171717',
    '--popover-foreground': '#fafafa',
    '--primary': '#e5e5e5',
    '--primary-foreground': '#171717',
    '--secondary': '#262626',
    '--secondary-foreground': '#fafafa',
    '--muted': '#262626',
    '--muted-foreground': '#a1a1a1',
    '--accent': '#404040',
    '--accent-foreground': '#fafafa',
    '--destructive': '#ff6568',
    '--destructive-foreground': '#df2225',
    '--border': 'rgb(255 255 255 / 0.07)',
    '--input': 'rgb(255 255 255 / 0.15)',
    '--ring': '#737373',
    '--radius': '0.625rem',
    '--font-sans': SANS,
    '--font-mono': MONO
  }
}
