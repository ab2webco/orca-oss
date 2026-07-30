import { describe, expect, it } from 'vitest'
import type { ITheme } from '@xterm/xterm'
import { composeActiveTerminalTheme } from './terminal-appearance'
import type { GlobalSettings } from '../../../../shared/types'

describe('composeActiveTerminalTheme', () => {
  function settingsWith(partial: Partial<GlobalSettings>): GlobalSettings {
    return {
      terminalColorOverrides: undefined,
      terminalCursorOpacity: undefined,
      terminalBackgroundOpacity: undefined,
      ...partial
    } as GlobalSettings
  }

  it('adds a scrollbar slider ramp on top of the base theme', () => {
    const base = { background: '#101010', foreground: '#fafafa', cursor: '#fafafa' }
    const result = composeActiveTerminalTheme(base, settingsWith({}))
    expect(result).toEqual({
      overviewRulerBorder: 'transparent',
      scrollbarSliderBackground: 'rgba(180, 180, 185, 0.55)',
      scrollbarSliderHoverBackground: 'rgba(180, 180, 185, 0.75)',
      scrollbarSliderActiveBackground: 'rgba(180, 180, 185, 0.9)',
      ...base
    })
  })

  it('lets the base theme override the ruler border but not the slider ramp', () => {
    // Why the slider wins: no builtin theme, ghostty/warp import, or TerminalColorOverrides key
    // can carry a slider slot, so a value here is stale state rather than user intent — and the
    // derived ramp is the only thing that keeps a 7px bar legible on this background (ORCA-133).
    const result = composeActiveTerminalTheme(
      {
        background: '#101010',
        overviewRulerBorder: '#222222',
        scrollbarSliderBackground: 'rgba(1, 2, 3, 0.4)'
      },
      settingsWith({})
    )

    expect(result!.overviewRulerBorder).toBe('#222222')
    expect(result!.scrollbarSliderBackground).toBe('rgba(180, 180, 185, 0.55)')
  })

  it('layers terminalColorOverrides on top of the base theme', () => {
    const base = { background: '#101010', foreground: '#fafafa' }
    const result = composeActiveTerminalTheme(
      base,
      settingsWith({ terminalColorOverrides: { foreground: '#00ff00' } })
    )
    expect(result!.foreground).toBe('#00ff00')
    expect(result!.background).toBe('#101010')
  })

  it('applies background opacity by converting the hex background to rgba', () => {
    const base = { background: '#112233' }
    const result = composeActiveTerminalTheme(
      base,
      settingsWith({ terminalBackgroundOpacity: 0.5 })
    )
    expect(result!.background).toBe('rgba(17, 34, 51, 0.5)')
  })

  it('honors a zero background opacity', () => {
    // Why: pin against a regression where the guard becomes truthy-only
    // (e.g. `if (settings.terminalBackgroundOpacity)`) and silently drops
    // the user's intent to make the background fully transparent.
    const base = { background: '#112233' }
    const result = composeActiveTerminalTheme(base, settingsWith({ terminalBackgroundOpacity: 0 }))
    expect(result!.background).toBe('rgba(17, 34, 51, 0)')
  })

  it('applies cursor opacity only when the cursor is a hex color', () => {
    const base = { cursor: '#ffffff' }
    const result = composeActiveTerminalTheme(base, settingsWith({ terminalCursorOpacity: 0.3 }))
    expect(result!.cursor).toBe('rgba(255, 255, 255, 0.3)')
  })

  it('leaves named CSS cursor colors untouched when applying opacity', () => {
    const base = { cursor: 'red' }
    const result = composeActiveTerminalTheme(base, settingsWith({ terminalCursorOpacity: 0.3 }))
    expect(result!.cursor).toBe('red')
  })

  it('returns null when given a null base theme', () => {
    expect(composeActiveTerminalTheme(null, settingsWith({}))).toBeNull()
  })

  describe('scrollbar slider legibility', () => {
    const noOpacitySettings = {
      terminalColorOverrides: undefined,
      terminalBackgroundOpacity: undefined,
      terminalCursorOpacity: undefined
    }

    // Contrast of the composited slider against the composited terminal background. WCAG 1.4.11
    // asks 3:1 for non-text UI; the slider is 7px wide, so a miss here is an invisible thumb.
    function sliderContrastOverBackground(theme: ITheme): number {
      const slider = parseRgb(theme.scrollbarSliderBackground!)
      const background = parseRgb(theme.background!)
      const composited = {
        r: slider.r * slider.a + background.r * (1 - slider.a),
        g: slider.g * slider.a + background.g * (1 - slider.a),
        b: slider.b * slider.a + background.b * (1 - slider.a)
      }
      const lighter = Math.max(luminance(composited), luminance(background))
      const darker = Math.min(luminance(composited), luminance(background))
      return (lighter + 0.05) / (darker + 0.05)
    }

    function parseRgb(css: string): { r: number; g: number; b: number; a: number } {
      if (css.startsWith('#')) {
        return {
          r: Number.parseInt(css.slice(1, 3), 16),
          g: Number.parseInt(css.slice(3, 5), 16),
          b: Number.parseInt(css.slice(5, 7), 16),
          a: 1
        }
      }
      const parts = css
        .replace(/^rgba?\(|\)$/g, '')
        .split(',')
        .map((part) => Number.parseFloat(part))
      return { r: parts[0], g: parts[1], b: parts[2], a: parts[3] ?? 1 }
    }

    function luminance(rgb: { r: number; g: number; b: number }): number {
      const toLinear = (channel: number): number => {
        const normalized = channel / 255
        return normalized <= 0.03928
          ? normalized / 12.92
          : Math.pow((normalized + 0.055) / 1.055, 2.4)
      }
      return 0.2126 * toLinear(rgb.r) + 0.7152 * toLinear(rgb.g) + 0.0722 * toLinear(rgb.b)
    }

    it('keeps the slider legible on a dark terminal background', () => {
      const theme = composeActiveTerminalTheme(
        { background: '#282c34' },
        noOpacitySettings,
        'dark'
      )!
      expect(sliderContrastOverBackground(theme)).toBeGreaterThanOrEqual(3)
    })

    it('keeps the slider legible on a light terminal background', () => {
      const theme = composeActiveTerminalTheme(
        { background: '#ffffff' },
        noOpacitySettings,
        'light'
      )!
      expect(sliderContrastOverBackground(theme)).toBeGreaterThanOrEqual(3)
    })

    it('darkens the slider for a light theme parked in the dark slot', () => {
      const light = composeActiveTerminalTheme(
        { background: '#ffffff' },
        noOpacitySettings,
        'dark'
      )!
      const dark = composeActiveTerminalTheme({ background: '#000000' }, noOpacitySettings, 'dark')!
      expect(light.scrollbarSliderBackground).not.toBe(dark.scrollbarSliderBackground)
      expect(sliderContrastOverBackground(light)).toBeGreaterThanOrEqual(3)
    })

    it('follows a background rewritten by color overrides, not the base theme', () => {
      const theme = composeActiveTerminalTheme(
        { background: '#000000' },
        { ...noOpacitySettings, terminalColorOverrides: { background: '#ffffff' } },
        'light'
      )!
      expect(sliderContrastOverBackground(theme)).toBeGreaterThanOrEqual(3)
    })

    it('ramps rest < hover < active so the grabbed thumb reads as grabbed', () => {
      const theme = composeActiveTerminalTheme(
        { background: '#282c34' },
        noOpacitySettings,
        'dark'
      )!
      expect(parseRgb(theme.scrollbarSliderBackground!).a).toBeLessThan(
        parseRgb(theme.scrollbarSliderHoverBackground!).a
      )
      expect(parseRgb(theme.scrollbarSliderHoverBackground!).a).toBeLessThan(
        parseRgb(theme.scrollbarSliderActiveBackground!).a
      )
    })
  })
})
