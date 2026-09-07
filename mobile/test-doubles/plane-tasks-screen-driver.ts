import { act } from 'react'

export function byLabel(label: string): HTMLElement | null {
  return document.body.querySelector<HTMLElement>(`[aria-label="${label}"]`)
}
export function leafWithText(text: string, scope: ParentNode = document.body): HTMLElement | null {
  for (const element of scope.querySelectorAll<HTMLElement>('div')) {
    if (element.childElementCount === 0 && element.textContent === text) {
      return element
    }
  }
  return null
}
export function typeInto(input: HTMLInputElement | HTMLTextAreaElement, value: string): void {
  // Why: React ignores a plain `.value =` on a controlled input; the prototype
  // setter plus an input event is what a keystroke looks like to it.
  const prototype =
    input instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype
  const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set
  if (!setter) {
    throw new Error('HTMLInputElement has no value setter')
  }
  act(() => {
    setter.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}
/** The surface reads status.get, then states + items; each hop is a microtask boundary. */
export async function settle(): Promise<void> {
  for (let hop = 0; hop < 12; hop += 1) {
    await act(async () => {
      await Promise.resolve()
    })
  }
}
export async function press(label: string): Promise<void> {
  const target = byLabel(label)
  if (!target) {
    throw new Error(`no control labelled ${label}`)
  }
  await act(async () => {
    target.click()
    await Promise.resolve()
  })
  await settle()
}
export async function openCard(): Promise<void> {
  await press('Open Wire the retry')
}
/** Everything a board card says: title, its facts line and its state pill. */
export function cardText(title: string): string {
  const card = byLabel(`Open ${title}`)
  if (!card) {
    throw new Error(`no card titled ${title}`)
  }
  return card.textContent ?? ''
}
/** The shell's column header: the state name beside its card count. */
export function boardColumn(name: string): { count: number } | null {
  for (const leaf of document.body.querySelectorAll<HTMLElement>('div')) {
    if (leaf.childElementCount !== 0 || leaf.textContent !== name) {
      continue
    }
    const count = leaf.nextElementSibling?.textContent ?? ''
    if (/^\d+$/.test(count)) {
      return { count: Number(count) }
    }
  }
  return null
}
/** The view chip opens a picker, so switching view is two presses (ORCA-418). */
export async function selectPlaneView(mode: 'list' | 'board'): Promise<void> {
  await press('Plane view')
  await press(`Show as ${mode}`)
}
