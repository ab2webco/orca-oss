import { describe, expect, it } from 'vitest'
import { getUpdateCheckClickOptions, getUpdateCheckHint } from './update-check-click-options'

function clickEvent(
  overrides: Partial<Pick<MouseEvent, 'ctrlKey' | 'metaKey' | 'shiftKey' | 'altKey'>>
) {
  return {
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    altKey: false,
    ...overrides
  } as Pick<MouseEvent, 'ctrlKey' | 'metaKey' | 'shiftKey' | 'altKey'>
}

describe('getUpdateCheckClickOptions', () => {
  it('uses Cmd on macOS for perf prerelease checks', () => {
    expect(getUpdateCheckClickOptions(clickEvent({ metaKey: true }), true)).toEqual({
      includePrerelease: false,
      includePerfPrerelease: true,
      includeLabRcPrerelease: false
    })
    expect(getUpdateCheckClickOptions(clickEvent({ ctrlKey: true }), true)).toEqual({
      includePrerelease: false,
      includePerfPrerelease: false,
      includeLabRcPrerelease: false
    })
  })

  it('uses Ctrl outside macOS for perf prerelease checks', () => {
    expect(getUpdateCheckClickOptions(clickEvent({ ctrlKey: true }), false)).toEqual({
      includePrerelease: false,
      includePerfPrerelease: true,
      includeLabRcPrerelease: false
    })
    expect(getUpdateCheckClickOptions(clickEvent({ metaKey: true }), false)).toEqual({
      includePrerelease: false,
      includePerfPrerelease: false,
      includeLabRcPrerelease: false
    })
  })

  it('keeps Shift as the RC prerelease modifier', () => {
    expect(
      getUpdateCheckClickOptions(clickEvent({ shiftKey: true, ctrlKey: true }), false)
    ).toEqual({
      includePrerelease: true,
      includePerfPrerelease: true,
      includeLabRcPrerelease: false
    })
  })

  it('routes Alt to the lab release-candidate channel on every platform', () => {
    // Why: lab RCs are hidden from ordinary checks, so this modifier is the only in-app way to
    // reach one. Alt is platform-neutral, unlike the Cmd/Ctrl split perf uses.
    expect(getUpdateCheckClickOptions(clickEvent({ altKey: true }), true)).toEqual({
      includePrerelease: false,
      includePerfPrerelease: false,
      includeLabRcPrerelease: true
    })
    expect(getUpdateCheckClickOptions(clickEvent({ altKey: true }), false)).toEqual({
      includePrerelease: false,
      includePerfPrerelease: false,
      includeLabRcPrerelease: true
    })
  })

  it('formats the tooltip hint by platform', () => {
    expect(getUpdateCheckHint(true)).toBe(
      '⇧+click checks the latest RC; ⌘+click checks the latest perf build; ⌥+click checks the latest lab release candidate.'
    )
    expect(getUpdateCheckHint(false)).toBe(
      'Shift+click checks the latest RC; Ctrl+click checks the latest perf build; Alt+click checks the latest lab release candidate.'
    )
  })
})
