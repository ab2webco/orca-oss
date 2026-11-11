import { describe, expect, it } from 'vitest'
import { addMemberPromptOf } from './new-tab-add-member-prompt'

const TICKET = {
  identifier: 'ORCA-9',
  title: 'Fix it',
  prompt: 'Work on ORCA-9: Fix it\nhttps://plane/ORCA-9'
}

// Why (ORCA-717): Add a member asks the lead with the project's own work-on prompt, and names the account.
describe('addMemberPromptOf', () => {
  it("sends the project's work-on prompt and the launch on the picked account", () => {
    expect(addMemberPromptOf(TICKET, 'acct-2')).toBe(
      'Work on ORCA-9: Fix it\nhttps://plane/ORCA-9\n\nLaunch its member with: orca game launch ORCA-9 --account acct-2'
    )
  })

  it("leaves the account to the lead's host when the menu has none to pick", () => {
    expect(addMemberPromptOf(TICKET, null)).toBe(
      'Work on ORCA-9: Fix it\nhttps://plane/ORCA-9\n\nLaunch its member with: orca game launch ORCA-9'
    )
  })
})
