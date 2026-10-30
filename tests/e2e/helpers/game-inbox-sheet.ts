import type { Page } from '@stablyai/playwright-test'
import { expect } from '@stablyai/playwright-test'

// The sheet slides in over 300ms and eases its width over 150ms on each resize, so a capture
// taken straight after the resize shows a frame mid-motion; wait for the motion, then check the box.
export async function settleGameInboxSheet(page: Page, width: number): Promise<void> {
  await page.setViewportSize({ width, height: 900 })
  const sheet = page.getByTestId('game-inbox-sheet')
  await expect(sheet).toHaveAttribute('data-state', 'open')
  await sheet.evaluate(async (node) => {
    await Promise.allSettled(node.getAnimations({ subtree: true }).map((one) => one.finished))
  })
  const box = await sheet.boundingBox()
  if (!box) {
    throw new Error(`the Inbox sheet has no box at ${width}px`)
  }
  expect(box.x, `left edge at ${width}px`).toBeGreaterThanOrEqual(0)
  expect(box.x + box.width, `right edge at ${width}px`).toBeLessThanOrEqual(width)
}
