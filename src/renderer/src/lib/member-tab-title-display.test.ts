import { describe, expect, it } from 'vitest'
import { memberTabTitleForDisplay } from './member-tab-title-display'

// Why (ORCA-1149): main stores a member's tab as `name · ticket · local`; the tab shows the machine's name.
describe('memberTabTitleForDisplay', () => {
  it("names this machine in a game member's tab", () => {
    expect(memberTabTitleForDisplay('Merlín · ORCA-12 · local', 'This computer')).toBe(
      'Merlín · ORCA-12 · This computer'
    )
  })

  it("uses the user's name for this machine", () => {
    expect(memberTabTitleForDisplay('Merlín · ORCA-12 · local', 'Studio')).toBe(
      'Merlín · ORCA-12 · Studio'
    )
  })

  it('leaves a member on a paired host as it is', () => {
    expect(memberTabTitleForDisplay('Merlín · ORCA-12 · imac', 'This computer')).toBe(
      'Merlín · ORCA-12 · imac'
    )
  })

  it('leaves any other title as it is', () => {
    for (const title of [
      'local',
      'zsh · local',
      'Merlín · not a ticket · local',
      'Merlín · ORCA-12'
    ]) {
      expect(memberTabTitleForDisplay(title, 'This computer')).toBe(title)
    }
  })
})
