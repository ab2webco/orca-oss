/**
 * ORCA-1062: collapsing an expanded split refits on the next frame and used to
 * focus the terminal there. CI's never-shown window runs frames ~1 s apart, so
 * that frame could land after Cmd/Ctrl+F and pull focus out of the search input.
 */

import { test, expect } from './helpers/orca-app'
import {
  countVisibleTerminalPanes,
  focusActiveTerminalInput,
  waitForActivePanePtyId,
  waitForActiveTerminalManager,
  waitForPaneCount
} from './helpers/terminal'
import { waitForSessionReady, waitForActiveWorktree, ensureTerminalVisible } from './helpers/store'

const isMac = process.platform === 'darwin'
const mod = isMac ? 'Meta' : 'Control'
// Why: Linux/Windows reserve Ctrl+D for EOF, so vertical split is Ctrl+Shift+D there.
const splitVerticalChord = isMac ? `${mod}+d` : `${mod}+Shift+d`

test('a collapse frame that lands after Cmd/Ctrl+F leaves focus in the search input', async ({
  orcaPage
}) => {
  await waitForSessionReady(orcaPage)
  await waitForActiveWorktree(orcaPage)
  await ensureTerminalVisible(orcaPage)
  const hasPaneManager = await waitForActiveTerminalManager(orcaPage, 30_000)
    .then(() => true)
    .catch(() => false)
  test.skip(
    !hasPaneManager,
    'Electron automation in this environment never mounts the live TerminalPane manager.'
  )
  await waitForPaneCount(orcaPage, 1, 30_000)

  const panesBeforeSplit = await countVisibleTerminalPanes(orcaPage)
  await focusActiveTerminalInput(orcaPage)
  await orcaPage.keyboard.press(splitVerticalChord)
  await waitForPaneCount(orcaPage, panesBeforeSplit + 1)
  await waitForActivePanePtyId(orcaPage)
  await focusActiveTerminalInput(orcaPage)
  await orcaPage.keyboard.press(`${mod}+Shift+Enter`)

  // Why: hold frame callbacks so the collapse's refit frame runs after Cmd/Ctrl+F.
  await orcaPage.evaluate(() => {
    const held: FrameRequestCallback[] = []
    ;(window as unknown as { __heldFrames: FrameRequestCallback[] }).__heldFrames = held
    window.requestAnimationFrame = (callback: FrameRequestCallback): number => {
      held.push(callback)
      return 0
    }
  })
  await focusActiveTerminalInput(orcaPage)
  await orcaPage.keyboard.press(`${mod}+Shift+Enter`)
  await focusActiveTerminalInput(orcaPage)
  await orcaPage.keyboard.press(`${mod}+f`)
  const searchInput = orcaPage.locator('[data-terminal-search-root] input').first()
  await expect(searchInput).toBeFocused({ timeout: 3_000 })

  const heldFrames = await orcaPage.evaluate(() => {
    const held = (window as unknown as { __heldFrames: FrameRequestCallback[] }).__heldFrames
    const callbacks = held.splice(0)
    for (const callback of callbacks) {
      callback(performance.now())
    }
    return callbacks.length
  })
  expect(heldFrames).toBeGreaterThan(0)
  await expect(searchInput).toBeFocused({ timeout: 1_000 })
})
