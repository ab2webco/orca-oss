import { PANEL_DESIGN_TOKEN_ALLOWLIST } from '../../../../shared/plugins/plugin-panel-shell'
import { buildPanelDesignTokenCssFromValues } from '../../../../shared/plugins/plugin-panel-shell-fill'

/**
 * Snapshots the curated design-token subset from the live document so panel
 * documents can match the app without any access to it. Values are read from
 * computed styles (trusted origin) but still stripped of structural CSS
 * characters before landing inside the shell's <style> block.
 */
export function buildPanelDesignTokenCss(): string {
  const styles = getComputedStyle(document.documentElement)
  return buildPanelDesignTokenCssFromValues(
    Object.fromEntries(
      PANEL_DESIGN_TOKEN_ALLOWLIST.map((token) => [token, styles.getPropertyValue(token)])
    )
  )
}

export function currentPanelColorScheme(): 'light' | 'dark' {
  return document.documentElement.classList.contains('dark') ? 'dark' : 'light'
}
