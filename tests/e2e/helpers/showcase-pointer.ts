import type { Locator, Page } from '@stablyai/playwright-test'
import { RECORDING_CLIPS } from './showcase-clip'

// Decoration for the recording only: outside ORCA_SHOWCASE_CLIPS=1 these act as plain locator calls.
type PointerWindow = { showcasePointerAt: (x: number, y: number) => void }
const last = new WeakMap<Page, { x: number; y: number }>()
const GLIDE_MS = 500

const placeArrow = (page: Page, x: number, y: number) =>
  page.evaluate(
    ([ax, ay]) => (window as unknown as PointerWindow).showcasePointerAt(ax, ay),
    [x, y]
  )

// Why: the frame recorder captures no OS cursor, so a DOM arrow stands in for it in the clip.
export async function showPointer(page: Page, x: number, y: number): Promise<void> {
  if (!RECORDING_CLIPS) {
    return
  }
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
  last.set(page, { x, y })
  await page.mouse.move(x, y)
  await placeArrow(page, x, y)
}

// Why the arrow is placed by hand: over a webview the host page never sees the mouse move.
export async function movePointer(page: Page, x: number, y: number, ms = GLIDE_MS): Promise<void> {
  if (!RECORDING_CLIPS) {
    return
  }
  const from = last.get(page) ?? { x, y }
  const start = Date.now()
  // Why time, not steps: a slow host still ends the glide on budget.
  for (let progress = 0; progress < 1; ) {
    progress = Math.min(1, (Date.now() - start) / ms)
    const px = from.x + (x - from.x) * progress
    const py = from.y + (y - from.y) * progress
    await page.mouse.move(px, py)
    await placeArrow(page, px, py)
  }
  last.set(page, { x, y })
}

export async function glideTo(page: Page, target: Locator, ms = GLIDE_MS): Promise<void> {
  if (!RECORDING_CLIPS) {
    await target.hover()
    return
  }
  await target.scrollIntoViewIfNeeded()
  const box = await target.boundingBox()
  if (!box) {
    throw new Error('glide target has no box')
  }
  await movePointer(page, box.x + box.width / 2, box.y + box.height / 2, ms)
}

export async function glideAndClick(page: Page, target: Locator, ms = GLIDE_MS): Promise<void> {
  if (RECORDING_CLIPS) {
    await glideTo(page, target, ms)
  }
  await target.click()
}
