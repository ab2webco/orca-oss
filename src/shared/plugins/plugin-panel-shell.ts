import { PANEL_PING_TYPE, PANEL_PONG_TYPE } from './plugin-panel-bridge'
import {
  PANEL_SANS_FONT_DATA_URI,
  PANEL_SANS_FONT_FAMILY,
  PANEL_SANS_FONT_WEIGHT_RANGE
} from './plugin-panel-sans-font'

/**
 * Host-generated shell wrapped around plugin panel HTML before it is handed
 * to the sandboxed iframe. The shell's job is to make the CSP parse BEFORE
 * any plugin content does: an opaque-origin sandboxed iframe without a CSP
 * can still fetch() CORS-permissive endpoints and beacon data out via <img>.
 *
 * Prepending works because (a) a CSP <meta> applies from the moment it
 * parses and cannot be un-applied by later markup or DOM removal, and (b) a
 * second CSP meta from the plugin can only intersect (tighten), never loosen.
 * The plugin document merges into the shell's open <head>/<html>, so design
 * tokens defined here are visible to plugin CSS as ordinary custom
 * properties.
 *
 * Electron-free string builder: desktop main and headless serve both wrap
 * panel HTML through this one function.
 */

export const PLUGIN_PANEL_CSP =
  "default-src 'none'; connect-src 'none'; script-src 'unsafe-inline'; " +
  "style-src 'unsafe-inline'; img-src data:; font-src data:; base-uri 'none'; form-action 'none'"

/** Renderer-substituted placeholders. Main cannot know the renderer's theme
 *  or token values; the renderer replaces these with a color-scheme class and
 *  CSS custom-property declarations before mounting the srcdoc. */
export const PANEL_SHELL_TOKENS_PLACEHOLDER = '/*__ORCA_PANEL_TOKENS__*/'
export const PANEL_SHELL_COLOR_SCHEME_PLACEHOLDER = '__ORCA_COLOR_SCHEME__'

/** Curated design-token subset injected into panel documents. Deliberately
 *  NOT all of main.css (~257 custom properties): freezing every token as
 *  public API would lock future refactors. Grow additively; renaming or
 *  dropping an entry here is a plugin-facing breaking change. */
export const PANEL_DESIGN_TOKEN_ALLOWLIST = [
  '--background',
  '--foreground',
  '--card',
  '--card-foreground',
  '--popover',
  '--popover-foreground',
  '--primary',
  '--primary-foreground',
  '--secondary',
  '--secondary-foreground',
  '--muted',
  '--muted-foreground',
  '--accent',
  '--accent-foreground',
  '--destructive',
  '--destructive-foreground',
  '--border',
  '--input',
  '--ring',
  '--radius',
  '--font-sans',
  '--font-mono'
] as const

/** Fallback stack for the case where token injection never ran (headless
 *  serve hands the shell out unfilled); mirrors main.css `--app-font-family`. */
const PANEL_SANS_FALLBACK_STACK = `'${PANEL_SANS_FONT_FAMILY}', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif`

/** Base layer, not a component library: the app's font, the radius scale the
 *  styleguide derives from `--radius`, and the body defaults a panel would
 *  otherwise re-derive by hand. Every rule here is either an `@font-face`, a
 *  custom property, a zero-specificity universal selector, or a single-element
 *  `body` rule — plugin CSS parses later in the same document, so a panel's own
 *  declaration always wins. Deliberately silent on input/button/select so an
 *  existing panel's controls keep the look they shipped with. */
const PANEL_BASE_STYLE =
  '<style>\n' +
  `@font-face{font-family:'${PANEL_SANS_FONT_FAMILY}';src:url(${PANEL_SANS_FONT_DATA_URI}) format('woff2');font-weight:${PANEL_SANS_FONT_WEIGHT_RANGE};font-style:normal;font-display:swap}\n` +
  ':root{--radius-sm:calc(var(--radius) * 0.6);--radius-md:calc(var(--radius) * 0.8);' +
  '--radius-lg:var(--radius);--radius-xl:calc(var(--radius) * 1.4);' +
  '--radius-2xl:calc(var(--radius) * 1.8);--radius-3xl:calc(var(--radius) * 2.2);' +
  '--radius-4xl:calc(var(--radius) * 2.6)}\n' +
  '*,*::before,*::after{box-sizing:border-box}\n' +
  `body{font-family:var(--font-sans, ${PANEL_SANS_FALLBACK_STACK});font-size:14px;` +
  'line-height:1.5;letter-spacing:0.01em;-webkit-font-smoothing:antialiased;' +
  '-moz-osx-font-smoothing:grayscale}\n' +
  '</style>\n'

export function buildPluginPanelShellHtml(pluginHtml: string): string {
  // The inline ping responder proves the frame's event loop is alive; the
  // renderer watchdog demotes the panel when pongs stop arriving.
  const prelude =
    '<!doctype html>\n' +
    `<html class="${PANEL_SHELL_COLOR_SCHEME_PLACEHOLDER}">\n` +
    '<head>\n' +
    '<meta charset="utf-8">\n' +
    `<meta http-equiv="Content-Security-Policy" content="${PLUGIN_PANEL_CSP}">\n` +
    `${PANEL_BASE_STYLE}<style>:root{${PANEL_SHELL_TOKENS_PLACEHOLDER}}</style>\n` +
    '<script>\n' +
    "'use strict'\n" +
    '// Host policy: plugin panels are documents, never browsing contexts.\n' +
    "if (window.navigation && typeof window.navigation.addEventListener === 'function') {\n" +
    "  window.navigation.addEventListener('navigate', function (event) {\n" +
    '    if (event.cancelable) event.preventDefault()\n' +
    '  })\n' +
    '}\n' +
    "try { Object.defineProperty(window, 'open', { value: function () { return null }, writable: false, configurable: false }) }\n" +
    'catch (_) { try { window.open = function () { return null } } catch (_) {} }\n' +
    "window.addEventListener('click', function (event) {\n" +
    '  var node = event.target\n' +
    '  while (node && node !== document) {\n' +
    "    if (node.nodeType === 1 && node.tagName === 'A' && node.hasAttribute('href')) {\n" +
    '      event.preventDefault()\n' +
    '      event.stopImmediatePropagation()\n' +
    '      return\n' +
    '    }\n' +
    '    node = node.parentNode\n' +
    '  }\n' +
    '}, true)\n' +
    "window.addEventListener('submit', function (event) {\n" +
    '  event.preventDefault()\n' +
    '  event.stopImmediatePropagation()\n' +
    '}, true)\n' +
    "window.addEventListener('message', function (event) {\n" +
    '  var data = event.data\n' +
    `  if (event.source === window.parent && data && data.type === '${PANEL_PING_TYPE}') {\n` +
    `    window.parent.postMessage({ type: '${PANEL_PONG_TYPE}', pingId: data.pingId }, '*')\n` +
    '  }\n' +
    '})\n' +
    '</script>\n' +
    '</head>\n'
  return prelude + pluginHtml
}
