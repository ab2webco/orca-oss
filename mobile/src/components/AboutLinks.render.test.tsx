import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { Linking } from 'react-native'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Why: lucide's circular ESM re-exports do not load under Vite's runner; icons are not under test.
vi.mock('lucide-react-native', async () => {
  const { createElement: h } = await import('react')
  const Icon = () => h('span')
  return new Proxy(
    {},
    {
      get: (_target, name) => (typeof name === 'string' && name !== 'then' ? Icon : undefined),
      has: (_target, name) => typeof name === 'string' && name !== 'then'
    }
  )
})

import { AboutLinks } from './AboutLinks'

function leafWithText(text: string): HTMLElement | null {
  for (const element of document.body.querySelectorAll<HTMLElement>('div')) {
    if (element.childElementCount === 0 && element.textContent === text) {
      return element
    }
  }
  return null
}

function linkContaining(text: string): HTMLElement {
  const link = leafWithText(text)?.closest<HTMLElement>('[role="link"]')
  if (!link) {
    throw new Error(`no link showing ${text}`)
  }
  return link
}

describe('AboutLinks', () => {
  let container: HTMLDivElement
  let root: Root
  const openURL = vi.spyOn(Linking, 'openURL').mockResolvedValue(true)

  beforeEach(() => {
    openURL.mockClear()
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    act(() => root.render(<AboutLinks />))
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })

  it('shows the Orca Lab author, repository and X account', () => {
    expect(leafWithText('Fabian Altahona')).not.toBeNull()
    expect(leafWithText('ab2webco/orca-oss')).not.toBeNull()
    expect(leafWithText('@fabolivar23')).not.toBeNull()
  })

  it('shows none of the upstream links', () => {
    const text = container.textContent ?? ''
    expect(text).not.toMatch(/stablyai|onorca\.dev|orca_build/i)
  })

  it('opens the Orca Lab repository and X profile', () => {
    act(() => linkContaining('ab2webco/orca-oss').click())
    act(() => linkContaining('@fabolivar23').click())
    expect(openURL.mock.calls).toEqual([
      ['https://github.com/ab2webco/orca-oss'],
      ['https://x.com/fabolivar23']
    ])
  })
})
