import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  _resetGroupFocusIntentForTests,
  installGroupFocusIntentKeyWatch,
  mayClaimGroupFocusFromDomFocus,
  recordGroupKeyFocusIntent,
  recordGroupPointerFocusIntent
} from './group-focus-intent'

const EDITOR_GROUP = 'group-editor'
const BROWSER_GROUP = 'group-browser'

beforeEach(() => {
  _resetGroupFocusIntentForTests()
})

describe('group focus intent', () => {
  it('lets a group claim focus when no pointer press named another one', () => {
    expect(mayClaimGroupFocusFromDomFocus(EDITOR_GROUP)).toBe(true)
  })

  // The ORCA-314 sequence: the click lands in the browser group, then Monaco in
  // the editor group refocuses its own input and its focus event must not win.
  it('refuses a claim from the group the user just clicked away from', () => {
    recordGroupPointerFocusIntent(BROWSER_GROUP)
    expect(mayClaimGroupFocusFromDomFocus(EDITOR_GROUP)).toBe(false)
    expect(mayClaimGroupFocusFromDomFocus(BROWSER_GROUP)).toBe(true)
  })

  // The clause a naive fix silently breaks: keyboard and AT focus have no pointer
  // event of their own, so a guard that only trusted pointers would lock them out.
  it('lets keyboard focus into another group claim it after a pointer press', () => {
    recordGroupPointerFocusIntent(BROWSER_GROUP)
    recordGroupKeyFocusIntent()
    expect(mayClaimGroupFocusFromDomFocus(EDITOR_GROUP)).toBe(true)
  })

  it('takes any key input as the keyboard reclaiming the intent', () => {
    const target = {
      addEventListener: vi.fn(),
      removeEventListener: vi.fn()
    } as unknown as Window
    const dispose = installGroupFocusIntentKeyWatch(target)
    const [event, handler, options] = vi.mocked(target.addEventListener).mock.calls[0]
    expect(event).toBe('keydown')
    expect(options).toBe(true)

    recordGroupPointerFocusIntent(BROWSER_GROUP)
    expect(mayClaimGroupFocusFromDomFocus(EDITOR_GROUP)).toBe(false)
    ;(handler as () => void)()
    expect(mayClaimGroupFocusFromDomFocus(EDITOR_GROUP)).toBe(true)

    dispose()
    expect(target.removeEventListener).toHaveBeenCalledWith('keydown', handler, true)
  })

  it('keeps the refusal scoped to the pointer press, not to every later focus', () => {
    recordGroupPointerFocusIntent(BROWSER_GROUP)
    expect(mayClaimGroupFocusFromDomFocus(EDITOR_GROUP)).toBe(false)
    // The user's next pointer press names the editor group; its focus counts again.
    recordGroupPointerFocusIntent(EDITOR_GROUP)
    expect(mayClaimGroupFocusFromDomFocus(EDITOR_GROUP)).toBe(true)
  })
})
