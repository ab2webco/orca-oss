import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  STATUS_TONES,
  statusToneBadgeClass,
  statusToneBgClass,
  statusToneTextClass,
  type StatusTone
} from './status-tone'

const css = readFileSync(join(__dirname, '../assets/main.css'), 'utf8')

function themeBlock(selector: RegExp): string {
  const body = css.match(selector)?.groups?.body
  expect(body).toBeDefined()
  return body!
}

const LIGHT = themeBlock(/:root\s*\{(?<body>[\s\S]*?)\n\}/)
const DARK = themeBlock(/\.dark\s*\{(?<body>[\s\S]*?)\n\}/)

function resolveHex(block: string, token: string, depth = 0): string {
  const value = block.match(new RegExp(`--${token}:\\s*([^;]+);`))?.[1]?.trim()
  expect(value, `--${token}`).toBeDefined()
  const alias = value!.match(/^var\(--([\w-]+)\)$/)?.[1]
  if (alias && depth < 4) {
    return resolveHex(block, alias, depth + 1)
  }
  expect(value).toMatch(/^#([0-9a-f]{3}){1,2}$/i)
  return value!.length === 4 ? value!.replace(/[0-9a-f]/gi, (c) => c + c) : value!
}

function luminance(hex: string): number {
  const n = Number.parseInt(hex.slice(1), 16)
  const [r, g, b] = [n >> 16, (n >> 8) & 255, n & 255].map((v) => {
    const c = v / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

const TOKEN: Record<StatusTone, string> = {
  attention: 'status-attention',
  warning: 'status-warning',
  info: 'status-info',
  success: 'status-success',
  idle: 'status-idle'
}

describe('status tone tokens', () => {
  it.each([
    ['light', LIGHT],
    ['dark', DARK]
  ])('defines all five tones in the %s theme, readable as text on the background', (_, block) => {
    const background = resolveHex(block, 'background')
    for (const tone of STATUS_TONES) {
      expect(contrast(resolveHex(block, TOKEN[tone]), background), tone).toBeGreaterThanOrEqual(4.5)
    }
  })

  it('gives light and dark their own warning and info values', () => {
    expect(resolveHex(LIGHT, 'status-warning')).not.toBe(resolveHex(DARK, 'status-warning'))
    expect(resolveHex(LIGHT, 'status-info')).not.toBe(resolveHex(DARK, 'status-info'))
  })

  it('maps every tone into Tailwind', () => {
    for (const tone of STATUS_TONES) {
      expect(css).toContain(`--color-${TOKEN[tone]}: var(--${TOKEN[tone]});`)
    }
  })

  it('points the question glyph at the needs-you tone', () => {
    expect(LIGHT).toContain('--agent-question: var(--status-attention)')
    expect(DARK).toContain('--agent-question: var(--status-attention)')
  })
})

describe('status tone classes', () => {
  it('uses only the status tokens, never a raw palette hue', () => {
    for (const tone of STATUS_TONES) {
      const classes = [
        statusToneTextClass(tone),
        statusToneBgClass(tone),
        statusToneBadgeClass(tone)
      ]
      for (const cls of classes) {
        expect(cls).toContain(TOKEN[tone])
        expect(cls).not.toMatch(/(amber|emerald|yellow|green|red|sky|blue)-\d/)
      }
    }
  })
})
