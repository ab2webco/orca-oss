// @vitest-environment happy-dom

import React, { act, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { KeepControlInPlace } from './KeepControlInPlace'

// Why a fake layout: happy-dom lays nothing out, so the toggle's top follows the row above it.
const ROW = 40

function Page(): React.JSX.Element {
  const [isAboveShown, setIsAboveShown] = useState(true)
  return (
    <KeepControlInPlace>
      {isAboveShown ? <div data-above /> : null}
      <button type="button" onClick={() => setIsAboveShown((one) => !one)}>
        toggle
      </button>
    </KeepControlInPlace>
  )
}

afterEach(() => {
  vi.restoreAllMocks()
})

async function mount() {
  const scroller = document.createElement('div')
  scroller.style.overflowY = 'auto'
  document.body.appendChild(scroller)
  const scrollBy = vi.fn()
  scroller.scrollBy = scrollBy as typeof scroller.scrollBy
  const root = createRoot(scroller)
  await act(async () => root.render(<Page />))
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(
    function (this: HTMLElement) {
      const top = this.tagName === 'BUTTON' && scroller.querySelector('[data-above]') ? ROW : 0
      return { top } as DOMRect
    }
  )
  const button = scroller.querySelector('button')!
  return {
    button,
    scrollBy,
    unmount: () => {
      act(() => root.unmount())
      scroller.remove()
    }
  }
}

const settle = () => act(async () => await Promise.resolve())

describe('KeepControlInPlace (ORCA-1112 d)', () => {
  it('scrolls by what the rows above the pressed control moved it', async () => {
    const view = await mount()

    view.button.dispatchEvent(new Event('pointerdown', { bubbles: true }))
    await act(async () => view.button.click())
    await settle()
    expect(view.scrollBy).toHaveBeenCalledWith({ top: -ROW })
    view.unmount()
  })

  it('leaves the page alone when nothing was pressed', async () => {
    const view = await mount()

    await act(async () => view.button.click())
    await settle()
    expect(view.scrollBy).not.toHaveBeenCalled()
    view.unmount()
  })

  it('lets go once the person scrolls', async () => {
    const view = await mount()

    view.button.dispatchEvent(new Event('pointerdown', { bubbles: true }))
    view.button.dispatchEvent(new Event('wheel', { bubbles: true }))
    await act(async () => view.button.click())
    await settle()
    expect(view.scrollBy).not.toHaveBeenCalled()
    view.unmount()
  })
})
