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

// A placeholder wider than its box is cut mid-word, and the person cannot read what the box is for.
export async function expectGameInboxPlaceholdersFit(page: Page, width: number): Promise<void> {
  const cut = await page.getByTestId('game-inbox-sheet').evaluate((sheet) => {
    const context = document.createElement('canvas').getContext('2d')
    if (!context) {
      throw new Error('no 2d canvas to measure the placeholders')
    }
    return Array.from(sheet.querySelectorAll('input[placeholder]'))
      .filter((input): input is HTMLInputElement => input instanceof HTMLInputElement)
      .filter((input) => input.value === '' && input.clientWidth > 0)
      .filter((input) => {
        const style = getComputedStyle(input)
        context.font = style.font
        const room =
          input.clientWidth -
          Number.parseFloat(style.paddingLeft) -
          Number.parseFloat(style.paddingRight)
        return context.measureText(input.placeholder).width > room
      })
      .map((input) => input.placeholder)
  })
  expect(cut, `placeholders cut at ${width}px`).toEqual([])
}
