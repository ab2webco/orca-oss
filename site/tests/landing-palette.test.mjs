import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, it } from 'node:test'
import { readBuilt, REPO_DIR } from './support/built-html.mjs'

const appCss = readFileSync(path.join(REPO_DIR, 'src/renderer/src/assets/main.css'), 'utf8')

// The colours LandingLayout writes, per theme, as the browser reads them.
function paletteOf(html, selector) {
  const escaped = selector.replace(/[[\]'()]/g, '\\$&')
  const block = new RegExp(`${escaped}\\{([^}]*)\\}`).exec(html)
  assert.ok(block, `no ${selector} palette in the built landing`)
  return Object.fromEntries(
    [...block[1].matchAll(/--scene-([\w-]+):(#[0-9a-f]{3}(?:[0-9a-f]{3})?)\b/g)].map((m) => [
      m[1],
      m[2]
    ])
  )
}

const channel = (value) => {
  const c = value / 255
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
}
// main.css writes some colours short (#fff).
const longHex = (hex) => (hex.length === 4 ? `#${hex.slice(1).replace(/./g, '$&$&')}` : hex)
const luminance = (short) => {
  const hex = longHex(short)
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

    const roles = ['bg', 'surface', 'raised', 'line', 'fg', 'fg-2', 'muted', 'success']

    it('defines every role', () => {
      for (const role of roles) {
        assert.match(palette[role] ?? '', /^#(?:[0-9a-f]{3}){1,2}$/, role)
      }
    })

    // Why: the owner's rule is the editor's neutral theme, so no colour may exist outside main.css.
    it('takes every colour from the app theme', () => {
      for (const role of roles) {
        assert.ok(appCss.toLowerCase().includes(palette[role]), `${role} ${palette[role]}`)
      }
    })

    // WCAG AA for body text, on the page and inside boxes and recordings' captions.
    for (const role of ['fg', 'fg-2', 'success']) {
      it(`${role} text reads on the page and on a surface`, () => {
        assert.ok(contrast(palette[role], palette.bg) >= 4.5, `${role} on bg`)
        assert.ok(contrast(palette[role], palette.surface) >= 4.5, `${role} on surface`)
      })
    }

    // Why the page only: light muted on a surface is 4.4, so boxes carry fg-2 instead.
    it('muted text reads on the page', () => {
      assert.ok(contrast(palette.muted, palette.bg) >= 4.5)
    })
  })
}
