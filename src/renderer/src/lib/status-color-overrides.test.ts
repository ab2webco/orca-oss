// @vitest-environment happy-dom
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { STATUS_TONES } from '@/components/status-tone'
import {
  STATUS_COLOR_BACKGROUND,
  STATUS_COLOR_DEFAULTS,
  applyStatusColorOverrides,
  buildStatusColorCss,
  statusColorWarning
} from './status-color-overrides'

const css = readFileSync(join(__dirname, '../assets/main.css'), 'utf8')
const BLOCKS = {
  light: css.match(/:root\s*\{(?<body>[\s\S]*?)\n\}/)?.groups?.body ?? '',
  dark: css.match(/\.dark\s*\{(?<body>[\s\S]*?)\n\}/)?.groups?.body ?? ''
}

function resolve(block: string, token: string): string {
  const value = block.match(new RegExp(`--${token}:\\s*([^;]+);`))?.[1]?.trim() ?? ''
  const alias = value.match(/^var\(--([\w-]+)\)$/)?.[1]
  const hex = alias ? resolve(block, alias) : value
  return hex.length === 4 ? hex.replace(/[0-9a-f]/gi, (c) => c + c) : hex
}

afterEach(() => {
  document.head.innerHTML = ''
})

describe('status colour defaults', () => {
  it.each(['light', 'dark'] as const)('match the %s tokens in main.css', (theme) => {
    expect(STATUS_COLOR_BACKGROUND[theme]).toBe(resolve(BLOCKS[theme], 'background'))
    for (const tone of STATUS_TONES) {
      expect(STATUS_COLOR_DEFAULTS[theme][tone], tone).toBe(
        resolve(BLOCKS[theme], `status-${tone}`)
      )
    }
  })
})

describe('buildStatusColorCss', () => {
  it('emits a rule per theme for overridden tones only', () => {
    const rules = buildStatusColorCss({ light: { info: '#123456' }, dark: { success: '#00ff00' } })
    expect(rules).toContain(':root.light{--status-info:#123456;}')
    expect(rules).toContain(':root.dark{--status-success:#00ff00;}')
    expect(rules).not.toContain('--status-warning')
  })

  it('emits nothing without overrides and ignores invalid values', () => {
    expect(buildStatusColorCss(undefined)).toBe('')
    expect(buildStatusColorCss({ light: { info: 'red;}*{x:y' } })).toBe('')
  })
})

describe('applyStatusColorOverrides', () => {
  it('adds, updates and removes one style element', () => {
    applyStatusColorOverrides({ dark: { info: '#111111' } })
    applyStatusColorOverrides({ dark: { info: '#222222' } })
    const styles = document.head.querySelectorAll('style#orca-status-colors')
    expect(styles).toHaveLength(1)
    expect(styles[0].textContent).toContain('#222222')

    applyStatusColorOverrides({})
    expect(document.head.querySelector('style#orca-status-colors')).toBeNull()
  })
})

describe('statusColorWarning', () => {
  const dark = STATUS_COLOR_DEFAULTS.dark

  it('stays quiet for the defaults', () => {
    for (const tone of STATUS_TONES) {
      expect(statusColorWarning(tone, dark, STATUS_COLOR_BACKGROUND.dark), tone).toBeNull()
    }
  })

  it('names the tone a colour is too close to', () => {
    const palette = { ...dark, warning: '#ff6a6a' }
    expect(statusColorWarning('warning', palette, STATUS_COLOR_BACKGROUND.dark)).toEqual({
      kind: 'close',
      other: 'attention'
    })
  })

  it('flags a colour that cannot be read on the background', () => {
    const palette = { ...dark, info: '#1a1a2a' }
    expect(statusColorWarning('info', palette, STATUS_COLOR_BACKGROUND.dark)).toEqual({
      kind: 'contrast'
    })
  })
})
