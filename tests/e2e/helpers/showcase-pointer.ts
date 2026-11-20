import type { Locator, Page } from '@stablyai/playwright-test'

type PointerWindow = { showcasePointerAt: (x: number, y: number) => void }
const last = new WeakMap<Page, { x: number; y: number }>()

// Why: the frame recorder captures no OS cursor, so a DOM arrow stands in for it in the clip.
export async function showPointer(page: Page, x: number, y: number): Promise<void> {
  await page.evaluate(() => {
    const pointer = document.createElement('div')
    pointer.style.cssText =
      'position:fixed;left:0;top:0;pointer-events:none;z-index:2147483647;transform:translate(-100px,-100px)'
    pointer.innerHTML =
      '<svg width="20" height="24" viewBox="0 0 20 24"><path d="M2 2 L2 19 L7 14.5 L10 22 L13 20.7 L10 13.5 L17 13.5 Z" fill="#fff" stroke="#000" stroke-width="1.5"/></svg>'
    document.body.appendChild(pointer)
    ;(window as unknown as PointerWindow).showcasePointerAt = (px, py) => {
      pointer.style.transform = `translate(${px}px, ${py}px)`
    }
  })
  await movePointer(page, x, y, 1)
}

// Why the arrow is placed by hand: over a webview the host page never sees the mouse move.
export async function movePointer(page: Page, x: number, y: number, steps = 30): Promise<void> {
  const from = last.get(page) ?? { x, y }
  for (let step = 1; step <= steps; step++) {
    const px = from.x + ((x - from.x) * step) / steps
    const py = from.y + ((y - from.y) * step) / steps
    await page.mouse.move(px, py)
    await page.evaluate(
      ([ax, ay]) => (window as unknown as PointerWindow).showcasePointerAt(ax, ay),
      [px, py]
    )
  }
  last.set(page, { x, y })
}

export async function glideTo(page: Page, target: Locator, steps = 30): Promise<void> {
  await target.scrollIntoViewIfNeeded()
  const box = await target.boundingBox()
  if (!box) {
    throw new Error('glide target has no box')
  }
  await movePointer(page, box.x + box.width / 2, box.y + box.height / 2, steps)
}

export async function glideAndClick(page: Page, target: Locator, steps = 30): Promise<void> {
  await glideTo(page, target, steps)
  await page.mouse.down()
  await page.mouse.up()
}
