// @vitest-environment happy-dom

import { renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { NewTabTeamMenu } from './use-new-tab-team-menu'
import { useNewTabTeamActions } from './use-new-tab-team-actions'

const openTeamSession = vi.fn()
const send = vi.fn()
const promptHandles: (string | null | undefined)[] = []
const reopenTeamLead = vi.fn()
const launchAgentInNewTab = vi.fn()
const toastError = vi.fn()

vi.mock('@/components/team-panel/team-session-open', () => ({
  openTeamSession: (...args: unknown[]) => openTeamSession(...args)
}))
vi.mock('@/components/team-panel/use-team-lead-prompt', () => ({
  useTeamLeadPrompt: (handle?: string | null) => {
    promptHandles.push(handle)
    return handle ? send : null
  }
}))
vi.mock('./new-tab-lead-reopen', () => ({
  reopenTeamLead: (...args: unknown[]) => reopenTeamLead(...args)
}))
vi.mock('@/lib/launch-agent-in-new-tab', () => ({
  launchAgentInNewTab: (...args: unknown[]) => launchAgentInNewTab(...args)
}))
vi.mock('sonner', () => ({ toast: { error: (...args: unknown[]) => toastError(...args) } }))

const LEAD = {
  paneKey: 'tab-1:pane-1',
  terminalHandle: 'term_lead',
  worktreeId: 'wt-lead',
  host: { kind: 'local' }
} as const
const LIVE: NewTabTeamMenu = {
  state: { kind: 'lead-live', leadName: 'Alfred', lead: LEAD, todo: [], memberAgent: 'claude' },
  projectName: 'orca-oss',
  target: { kind: 'local' }
}
const CLOSED: NewTabTeamMenu = { ...LIVE, state: { kind: 'lead-closed', accountId: 'acct-glm' } }
const TICKET = { identifier: 'ORCA-9', title: 'Fix it', prompt: 'Work on ORCA-9' }

const actionsFor = (menu: NewTabTeamMenu, onFocusTerminal = vi.fn()) =>
  renderHook(() =>
    useNewTabTeamActions({ worktreeId: 'wt-1', groupId: 'g-1', menu, onFocusTerminal })
  ).result.current

beforeEach(() => {
  for (const mock of [openTeamSession, send, reopenTeamLead, launchAgentInNewTab, toastError]) {
    mock.mockReset()
  }
  promptHandles.length = 0
  send.mockResolvedValue(true)
  launchAgentInNewTab.mockReturnValue({ tabId: 'tab-new' })
})

// Why (ORCA-717): each Team row acts on the project's real lead, never on a second team.
describe('useNewTabTeamActions', () => {
  it("opens the live lead's pane by its name", () => {
    actionsFor(LIVE).onGoToLead()

    expect(openTeamSession).toHaveBeenCalledWith(LEAD, 'Alfred')
  })

  it('asks the live lead for a member on the ticket and account', () => {
    actionsFor(LIVE).onAddMember(TICKET, 'acct-2')

    expect(promptHandles).toContain('term_lead')
    expect(send).toHaveBeenCalledWith(
      'add-member:ORCA-9',
      'Work on ORCA-9\n\nLaunch its member with: orca game launch ORCA-9 --account acct-2',
      'ORCA-9'
    )
    expect(launchAgentInNewTab).not.toHaveBeenCalled()
  })

  it('reopens the kept lead through the host and opens no pane of its own', async () => {
    reopenTeamLead.mockResolvedValue({ kind: 'lead', handle: 'term_r' })

    await actionsFor(CLOSED).onReopen()

    expect(reopenTeamLead).toHaveBeenCalledWith(
      { kind: 'local' },
      { worktreeId: 'wt-1', project: 'orca-oss' }
    )
    expect(launchAgentInNewTab).not.toHaveBeenCalled()
    expect(toastError).not.toHaveBeenCalled()
  })

  it.each([
    [{ kind: 'failed', reason: 'No conversation found' }],
    [{ kind: 'nothing-kept' }],
    [{ kind: 'unsupported' }]
  ])('says the team did not reopen when the host answers %j', async (answer) => {
    reopenTeamLead.mockResolvedValue(answer)

    await actionsFor(CLOSED).onReopen()

    expect(toastError).toHaveBeenCalledTimes(1)
    expect(launchAgentInNewTab).not.toHaveBeenCalled()
  })

  it('starts a fresh lead in a new Agent Teams pane on the picked account and focuses it', () => {
    const onFocusTerminal = vi.fn()

    actionsFor(CLOSED, onFocusTerminal).onStartFresh('acct-free')

    expect(launchAgentInNewTab).toHaveBeenCalledWith({
      agent: 'claude-agent-teams',
      worktreeId: 'wt-1',
      groupId: 'g-1',
      prompt: '/orca-game:lead fresh',
      claudeAccountId: 'acct-free'
    })
    expect(onFocusTerminal).toHaveBeenCalledWith('tab-new')
    expect(reopenTeamLead).not.toHaveBeenCalled()
  })

  it("starts a fresh lead on the host's own login when there is no account to pick", () => {
    actionsFor(CLOSED).onStartFresh(null)

    expect(launchAgentInNewTab.mock.calls[0]?.[0]).not.toHaveProperty('claudeAccountId')
  })
})
