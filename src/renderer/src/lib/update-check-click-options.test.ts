import { describe, expect, it } from 'vitest'
import { getUpdateCheckClickOptions, getUpdateCheckHint } from './update-check-click-options'

function clickEvent(
  overrides: Partial<Pick<MouseEvent, 'altKey' | 'ctrlKey' | 'metaKey' | 'shiftKey'>>
) {
  return {
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    ...overrides
  } as Pick<MouseEvent, 'altKey' | 'ctrlKey' | 'metaKey' | 'shiftKey'>
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

  it('routes Alt+Shift to the lab release-candidate channel before local builds', () => {
    expect(getUpdateCheckClickOptions(clickEvent({ altKey: true, shiftKey: true }), true)).toEqual({
      includePrerelease: false,
      includePerfPrerelease: false,
      includeLabRcPrerelease: true
    })
    expect(getUpdateCheckClickOptions(clickEvent({ altKey: true, shiftKey: true }), false)).toEqual({
      includePrerelease: false,
      includePerfPrerelease: false,
      includeLabRcPrerelease: true
    })
  })

  it('keeps plain Option for local builds on macOS only', () => {
    expect(getUpdateCheckClickOptions(clickEvent({ altKey: true }), true)).toEqual({
      localBuild: true
    })
    expect(getUpdateCheckClickOptions(clickEvent({ altKey: true }), false)).toEqual({
      includePrerelease: false,
      includePerfPrerelease: false,
      includeLabRcPrerelease: false
    })
  })

  it('formats the tooltip hint by platform', () => {
    expect(getUpdateCheckHint(true)).toBe(
      '⇧+click checks the latest RC; ⌘+click checks the latest perf build. ⌥+click chooses a local macOS build; ⌥+⇧+click checks the latest lab release candidate.'
    )
    expect(getUpdateCheckHint(false)).toBe(
      'Shift+click checks the latest RC; Ctrl+click checks the latest perf build. Alt+Shift+click checks the latest lab release candidate.'
    )
  })
})
