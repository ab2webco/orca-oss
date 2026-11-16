import { describe, expect, it } from 'vitest'
import { colors } from '../theme/mobile-theme'
import { TEAM_SCENE_ENGINE_JS } from './team-scene-webview-engine.generated'
import { TEAM_SCENE_WEBVIEW_HTML } from './team-scene-webview-html'
import { TEAM_SCENE_CANVAS_ID } from './team-scene-webview-messages'

describe('TEAM_SCENE_WEBVIEW_HTML', () => {
  it('runs the engine as its only script, after the canvas the engine looks for', () => {
    const scripts = [...TEAM_SCENE_WEBVIEW_HTML.matchAll(/<script>([\s\S]*?)<\/script>/g)]
    expect(scripts).toHaveLength(1)
    expect(scripts[0]![1]).toBe(TEAM_SCENE_ENGINE_JS)
    const canvasAt = TEAM_SCENE_WEBVIEW_HTML.indexOf(`<canvas id="${TEAM_SCENE_CANVAS_ID}">`)
    expect(canvasAt).toBeGreaterThan(-1)
    expect(canvasAt).toBeLessThan(scripts[0]!.index)
  })

  it('allows nothing from the network', () => {
    const csp = /http-equiv="Content-Security-Policy" content="([^"]*)"/.exec(
      TEAM_SCENE_WEBVIEW_HTML
    )?.[1]
    expect(csp).toContain("default-src 'none'")
    expect(csp).toContain("script-src 'unsafe-inline'")
    expect(csp).not.toMatch(/connect-src|https?:/)
    expect(TEAM_SCENE_WEBVIEW_HTML).not.toMatch(/https?:\/\//)
  })

  it('paints the page in the sheet’s background and keeps pixels square', () => {
    expect(TEAM_SCENE_WEBVIEW_HTML).toContain(`background: ${colors.bgBase}`)
    expect(TEAM_SCENE_WEBVIEW_HTML).toContain('image-rendering: pixelated')
  })
})
