import { describe, expect, it } from 'vitest'
import { getPtyReattachUnavailableNotice } from './pty-reattach-unavailable-notice'
import { REQUIRED_PTY_REATTACH_UNAVAILABLE } from '../../../../shared/pty-reattach-unavailable'

describe('getPtyReattachUnavailableNotice', () => {
  it('tells the user to relaunch the agent when the surviving process cannot be reattached', () => {
    const notice = getPtyReattachUnavailableNotice(
      `${REQUIRED_PTY_REATTACH_UNAVAILABLE}: PTY session "repo::/w/one@@abcdef01" is no longer available to reattach`
    )
    expect(notice).toContain('relaunching the agent')
    // Why: the raw marker leaking through is the blank-pane bug wearing a toast.
    expect(notice).not.toContain(REQUIRED_PTY_REATTACH_UNAVAILABLE)
  })

  it('leaves every other spawn failure to its own handling', () => {
    expect(getPtyReattachUnavailableNotice('No PTY provider for connection ssh-1')).toBeNull()
  })
})
