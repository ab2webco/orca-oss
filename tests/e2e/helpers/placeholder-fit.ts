import type { Locator } from '@stablyai/playwright-test'
import { expect } from '@stablyai/playwright-test'

// A placeholder wider than its box is cut mid-word, and the person cannot read what the box is for.
export async function expectPlaceholdersFit(scope: Locator, label: string): Promise<void> {
  const cut = await scope.evaluate((root) => {
    const context = document.createElement('canvas').getContext('2d')
    if (!context) {
      throw new Error('no 2d canvas to measure the placeholders')
    }
    return Array.from(root.querySelectorAll('input[placeholder]'))
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
  expect(cut, `placeholders cut ${label}`).toEqual([])
}
