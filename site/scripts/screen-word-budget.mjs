// Hallmark gate 58: at most 95 words on any 900 px screen of a landing page at 1440.
// The count follows hallmark's sloplint-render.mjs, so this check and hallmark agree.
export const SCREEN_WORD_BUDGET = 95

/** Runs in the page: the most words any 900 px window holds, and where that window starts. */
export function densestScreen() {
  const visible = (el) => {
    const style = getComputedStyle(el)
    if (
      style.display === 'none' ||
      style.visibility === 'hidden' ||
      Number.parseFloat(style.opacity) === 0
    ) {
      return false
    }
    const box = el.getBoundingClientRect()
    return box.width > 1 && box.height > 1
  }
  const words = []
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const parent = node.parentElement
    if (
      !parent ||
      !visible(parent) ||
      parent.closest('script, style, noscript, svg, [data-slot], [data-credits]')
    ) {
      continue
    }
    // Why two letters: hallmark counts a token as a word only when it has two ASCII letters in a row.
    const count = node.textContent
      .trim()
      .split(/\s+/)
      .filter((word) => /[A-Za-z]{2,}/.test(word)).length
    if (count) {
      const box = parent.getBoundingClientRect()
      words.push({ top: box.top + scrollY, bottom: box.bottom + scrollY, count })
    }
  }
  let densest = { words: 0, at: 0 }
  for (let y = 0; y < document.documentElement.scrollHeight; y += 50) {
    // A block that straddles the window counts in proportion to the part inside it.
    const inside = words.reduce((sum, w) => {
      const overlap = Math.max(0, Math.min(w.bottom, y + 900) - Math.max(w.top, y))
      return sum + w.count * Math.min(1, overlap / Math.max(1, w.bottom - w.top))
    }, 0)
    if (Math.round(inside) > densest.words) {
      densest = { words: Math.round(inside), at: y }
    }
  }
  return densest
}
