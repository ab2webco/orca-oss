import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { readBuilt } from './support/built-html.mjs'

// The docs share the landing's design language (ORCA-1176): main.css's theme, ink as the accent.
const EXPECTED = {
  dark: {
    black: '#0a0a0a',
    'gray-6': '#171717',
    'gray-5': '#262626',
    hairline: '#262626',
    white: '#fafafa',
    'gray-2': '#fafafa',
    'gray-3': '#a1a1a1',
    'accent-high': '#fafafa',
    green: '#34d399'
  },
  light: {
    black: '#fff',
    'gray-6': '#f5f5f5',
    'gray-5': '#e5e5e5',
    hairline: '#e5e5e5',
    white: '#0a0a0a',
    'gray-2': '#0a0a0a',
    'gray-3': '#737373',
    accent: '#0a0a0a',
    green: '#15803d'
  }
}

function paletteOf(html, selector) {
  const escaped = selector.replace(/[[\]'()]/g, '\\$&')
  const block = new RegExp(`${escaped}\\{(--sl-color[^}]*)\\}`).exec(html)
  assert.ok(block, `no ${selector} Starlight palette in the built docs`)
  return Object.fromEntries(
    [...block[1].matchAll(/--sl-color-([\w-]+):([^;]+);/g)].map((m) => [m[1], m[2]])
  )
}

const html = readBuilt('docs/get-started/index.html')
for (const [theme, selector] of [
  ['dark', ':root'],
  ['light', ":root[data-theme='light']"]
]) {
  describe(`docs palette (${theme})`, () => {
    it('maps Starlight onto the shared tokens', () => {
      const palette = paletteOf(html, selector)
      for (const [name, value] of Object.entries(EXPECTED[theme])) {
        assert.equal(palette[name], value, `--sl-color-${name}`)
      }
    })
  })
}
