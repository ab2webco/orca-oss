// @vitest-environment happy-dom

import { describe, expect, it } from 'vitest'
import { PANEL_CONTENT_HEIGHT_TYPE } from './plugin-panel-bridge'
import {
  buildPluginPanelShellHtml,
  PANEL_DESIGN_TOKEN_ALLOWLIST,
  PANEL_SHELL_TOKENS_PLACEHOLDER,
  PLUGIN_PANEL_CSP
} from './plugin-panel-shell'
import { PANEL_SANS_FONT_DATA_URI } from './plugin-panel-sans-font'

/** Runs the shell's inline prelude against a caller-supplied `window` so each
 *  test gets its own listeners and its own postMessage sink. */
function runShellPrelude(panelWindow: object): void {
  const script = buildPluginPanelShellHtml('<main>Plugin</main>').match(
    /<script>\n([\s\S]*?)<\/script>/
  )?.[1]
  if (!script) {
    throw new Error('shell prelude not found')
  }
  new Function('window', script)(panelWindow)
}

describe('buildPluginPanelShellHtml', () => {
  it('keeps destructive surface and foreground tokens paired', () => {
    expect(PANEL_DESIGN_TOKEN_ALLOWLIST).toEqual(
      expect.arrayContaining(['--destructive', '--destructive-foreground'])
    )
  })

  it('exposes the app font tokens so a panel can name Orca typography', () => {
    expect(PANEL_DESIGN_TOKEN_ALLOWLIST).toEqual(
      expect.arrayContaining(['--font-sans', '--font-mono'])
    )
  })

  it('embeds the app font as a data URI the panel CSP can load', () => {
    const html = buildPluginPanelShellHtml('<main id="plugin-content">Plugin</main>')
    const pluginOffset = html.indexOf('plugin-content')

    // font-src data: is the only font delivery an opaque-origin frame has.
    expect(PLUGIN_PANEL_CSP).toContain('font-src data:')
    expect(PANEL_SANS_FONT_DATA_URI.startsWith('data:font/woff2;base64,')).toBe(true)
    expect(html).toContain("@font-face{font-family:'Geist'")
    expect(html).toContain(`src:url(${PANEL_SANS_FONT_DATA_URI}) format('woff2')`)
    expect(html).toContain('font-weight:100 900')
    expect(html.indexOf('@font-face')).toBeLessThan(pluginOffset)
  })

  it('gives a panel Orca body typography, the radius scale, and border-box', () => {
    const html = buildPluginPanelShellHtml('<main id="plugin-content">Plugin</main>')
    const pluginOffset = html.indexOf('plugin-content')

    expect(html).toContain('*,*::before,*::after{box-sizing:border-box}')
    expect(html).toContain('--radius-sm:calc(var(--radius) * 0.6)')
    expect(html).toContain('--radius-md:calc(var(--radius) * 0.8)')
    expect(html).toContain('--radius-lg:var(--radius)')
    expect(html).toContain('--radius-xl:calc(var(--radius) * 1.4)')
    expect(html).toContain('font-family:var(--font-sans,')
    expect(html).toContain('font-size:14px')
    expect(html).toContain('letter-spacing:0.01em')
    expect(html.indexOf('box-sizing:border-box')).toBeLessThan(pluginOffset)

    // A panel that declares nothing must land on the base layer, not UA defaults.
    document.write(buildPluginPanelShellHtml('<body><p>Plugin</p></body>'))
    const bodyStyle = getComputedStyle(document.body)
    expect(bodyStyle.fontFamily).toContain('--font-sans')
    expect(bodyStyle.fontSize).toBe('14px')
    expect(bodyStyle.boxSizing).toBe('border-box')
    expect(bodyStyle.letterSpacing).not.toBe('normal')
  })

  it('lets the injected token snapshot override the derived radius scale', () => {
    const html = buildPluginPanelShellHtml('<main>Plugin</main>')

    // Same specificity, so the later rule wins: real tokens must parse last.
    expect(html.indexOf('--radius-sm:calc')).toBeLessThan(
      html.indexOf(PANEL_SHELL_TOKENS_PLACEHOLDER)
    )
  })

  it("keeps a panel's own font-family and font-size winning over the base layer", () => {
    const html = buildPluginPanelShellHtml(
      '<style>body{font-family:"Courier New",monospace;font-size:11px}</style>' +
        '<body><p id="plugin-content">Plugin</p></body>'
    )

    // The base layer is a single-element body rule parsed before plugin markup,
    // so an equally specific panel declaration overrides it by document order.
    expect(html.indexOf('font-family:var(--font-sans,')).toBeLessThan(
      html.indexOf('font-family:"Courier New"')
    )
    document.write(html)
    const bodyStyle = getComputedStyle(document.body)
    expect(bodyStyle.fontFamily).toContain('Courier New')
    expect(bodyStyle.fontFamily).not.toContain('--font-sans')
    expect(bodyStyle.fontSize).toBe('11px')
  })

  it('places CSP and navigation guards before plugin content', () => {
    const html = buildPluginPanelShellHtml('<main id="plugin-content">Plugin</main>')
    const pluginOffset = html.indexOf('plugin-content')

    expect(PLUGIN_PANEL_CSP).toContain("form-action 'none'")
    expect(html.indexOf('Content-Security-Policy')).toBeLessThan(pluginOffset)
    expect(html.indexOf("window.navigation.addEventListener('navigate'")).toBeLessThan(pluginOffset)
    expect(html.indexOf("window.addEventListener('click'")).toBeLessThan(pluginOffset)
    expect(html.indexOf("window.addEventListener('submit'")).toBeLessThan(pluginOffset)
    expect(html.indexOf("Object.defineProperty(window, 'open'")).toBeLessThan(pluginOffset)
  })

  it('cancels anchor and form default navigation in the fallback path', () => {
    const html = buildPluginPanelShellHtml('<main>Plugin</main>')
    const script = html.match(/<script>\n([\s\S]*?)<\/script>/)?.[1]
    expect(script).toBeTruthy()
    // Keep happy-dom's global removable for Vitest teardown; production shell
    // keeps the override non-configurable inside the disposable iframe.
    window.eval(script!.replace('configurable: false', 'configurable: true'))

    const anchor = document.createElement('a')
    anchor.href = 'https://example.com/'
    document.body.appendChild(anchor)
    const clickAccepted = anchor.dispatchEvent(
      new MouseEvent('click', { bubbles: true, cancelable: true })
    )
    const form = document.createElement('form')
    document.body.appendChild(form)
    const submitAccepted = form.dispatchEvent(
      new Event('submit', { bubbles: true, cancelable: true })
    )

    expect(clickAccepted).toBe(false)
    expect(submitAccepted).toBe(false)
    expect(window.open('https://example.com/')).toBeNull()
  })

  it('reports its content height to the host, once per change', async () => {
    // Its own window object, not the test's: the shell prelude is evaluated
    // twice in this file, and two live reporters would double every count.
    const reported: unknown[] = []
    const windowListeners = new Map<string, (event: unknown) => void>()
    const panelWindow = {
      parent: { postMessage: (message: unknown) => reported.push(message) },
      addEventListener: (type: string, listener: (event: unknown) => void) =>
        void windowListeners.set(type, listener)
    }
    Object.defineProperty(document.body, 'scrollHeight', { value: 420, configurable: true })
    runShellPrelude(panelWindow)

    const settle = async (): Promise<void> => {
      windowListeners.get('load')?.(new Event('load'))
      await new Promise((resolve) => setTimeout(resolve, 120))
    }

    // The host is sandboxed out of this document, so the only proof the height
    // ever reaches it is the frame the shell posts to window.parent.
    await settle()
    expect(reported).toEqual([{ type: PANEL_CONTENT_HEIGHT_TYPE, height: 420 }])

    // Content that arrives after load — the case a one-shot measurement misses.
    Object.defineProperty(document.body, 'scrollHeight', { value: 900, configurable: true })
    await settle()
    expect(reported.at(-1)).toEqual({ type: PANEL_CONTENT_HEIGHT_TYPE, height: 900 })

    // A repaint that resizes nothing must not spend the panel's bridge budget.
    await settle()
    expect(reported).toHaveLength(2)
  })

  it('measures from inside because the host can never read the frame', () => {
    const html = buildPluginPanelShellHtml('<main id="plugin-content">Plugin</main>')
    const pluginOffset = html.indexOf('plugin-content')

    expect(html).toContain('new ResizeObserver(queue)')
    expect(html).toContain('observer.observe(document.documentElement)')
    expect(html).toContain('observer.observe(document.body)')
    // The reporter must be installed before plugin content can resize anything.
    expect(html.indexOf(PANEL_CONTENT_HEIGHT_TYPE)).toBeLessThan(pluginOffset)
  })
})
