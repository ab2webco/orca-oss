import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { readBuilt } from './support/built-html.mjs'

// The scene colours LandingLayout writes, per theme, as the browser reads them.
function paletteOf(html, selector) {
  const escaped = selector.replace(/[[\]'()]/g, '\\$&')
  const block = new RegExp(`${escaped}\\{([^}]*)\\}`).exec(html)
  assert.ok(block, `no ${selector} palette in the built landing`)
  return Object.fromEntries(
    [...block[1].matchAll(/--scene-([\w-]+):(#[0-9a-f]{6})/g)].map((m) => [m[1], m[2]])
  )
}

const channel = (value) => {
  const c = value / 255
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
}
const luminance = (hex) => {
  const [r, g, b] = [1, 3, 5].map((i) => channel(Number.parseInt(hex.slice(i, i + 2), 16)))
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
const contrast = (a, b) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

const html = readBuilt('index.html')
for (const [theme, selector] of [
  ['dark', ':root'],
  ['light', ":root[data-theme='light']"]
]) {
  describe(`landing palette (${theme})`, () => {
    const palette = paletteOf(html, selector)

    it('defines every role from the scenes', () => {
      for (const role of ['bg', 'surface', 'line', 'fg', 'muted', 'link', 'gold']) {
        assert.match(palette[role] ?? '', /^#[0-9a-f]{6}$/, role)
      }
    })

    // WCAG AA for body text, on the page and inside boxes and recordings' captions.
    for (const role of ['fg', 'muted', 'link', 'gold', 'working', 'waiting', 'done']) {
      it(`${role} text reads on the page and on a surface`, () => {
        assert.ok(contrast(palette[role], palette.bg) >= 4.5, `${role} on bg`)
        assert.ok(contrast(palette[role], palette.surface) >= 4.5, `${role} on surface`)
      })
    }
  })
}
