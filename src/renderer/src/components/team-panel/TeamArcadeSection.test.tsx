// @vitest-environment happy-dom

import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TeamArcadeSection, type TeamArcadeActions } from './TeamArcadeSection'

vi.mock('@/i18n/i18n', () => ({
  translate: (_key: string, fallback: string, options?: Record<string, unknown>) =>
    fallback.replace(/\{\{(\w+)\}\}/g, (_, name: string) => String(options?.[name] ?? ''))
}))

const roots: ReturnType<typeof createRoot>[] = []

afterEach(async () => {
  await act(async () => {
    for (const root of roots.splice(0)) {
      root.unmount()
    }
  })
  document.body.innerHTML = ''
})

function actions(): TeamArcadeActions & {
  play: ReturnType<typeof vi.fn>
  keep: ReturnType<typeof vi.fn>
} {
  return { play: vi.fn(async () => {}), keep: vi.fn(async () => {}) }
}

async function render(arcade: { credits: number; offerPr: number | null }, on = actions()) {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  roots.push(root)
  await act(async () => {
    root.render(<TeamArcadeSection arcade={arcade} actions={on} />)
  })
  return { container, on }
}

const button = (container: HTMLElement, label: string): HTMLButtonElement =>
  [...container.querySelectorAll('button')].find((node) => node.textContent === label)!

describe('TeamArcadeSection', () => {
  it('congratulates the perfect merge and offers Play and Keep', async () => {
    const { container, on } = await render({ credits: 1, offerPr: 923 })
    const offer = container.querySelector<HTMLElement>('[data-arcade-offer]')!

    expect(offer.textContent).toContain('Perfect merge of #923')
    expect(offer.textContent).toContain('You won a play. It stays saved until you want it.')
    await act(async () => button(container, 'Keep').click())
    expect(on.keep).toHaveBeenCalledTimes(1)
    await act(async () => button(container, 'Play').click())
    expect(on.play).toHaveBeenCalledTimes(1)
  })

  it('shows the saved count with Play once the offer is gone', async () => {
    const one = await render({ credits: 1, offerPr: null })
    expect(one.container.querySelector('[data-arcade-offer]')).toBeNull()
    expect(one.container.querySelector('[data-arcade-credits]')!.textContent).toContain(
      '1 saved play'
    )

    const many = await render({ credits: 3, offerPr: null })
    expect(many.container.querySelector('[data-arcade-credits]')!.textContent).toContain(
      '3 saved plays'
    )
    await act(async () => button(many.container, 'Play').click())
    expect(many.on.play).toHaveBeenCalledTimes(1)
  })

  it('draws nothing with no saved play and no offer', async () => {
    const { container } = await render({ credits: 0, offerPr: null })
    expect(container.innerHTML).toBe('')
  })

  it('holds both buttons while a choice is on its way, so one click spends one play', async () => {
    let finish = (): void => {}
    const on = actions()
    on.play.mockImplementation(() => new Promise<void>((resolve) => (finish = resolve)))
    const { container } = await render({ credits: 2, offerPr: 923 }, on)

    await act(async () => button(container, 'Play').click())
    expect(button(container, 'Play').disabled).toBe(true)
    expect(button(container, 'Keep').disabled).toBe(true)
    await act(async () => button(container, 'Play').click())
    expect(on.play).toHaveBeenCalledTimes(1)

    await act(async () => finish())
    expect(button(container, 'Play').disabled).toBe(false)
  })
})
