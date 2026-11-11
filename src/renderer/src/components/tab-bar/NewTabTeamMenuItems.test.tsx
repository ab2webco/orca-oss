// @vitest-environment happy-dom

import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import type { NewTabAccountRow } from '../../../../shared/new-tab-account-choice'
import type { AgentRowAccount } from './new-tab-agent-row-account'
import { NewTabTeamMenuItems, type NewTabTeamMenuItemsProps } from './NewTabTeamMenuItems'

const openSettingsTarget = vi.fn()
const openSettingsPage = vi.fn()

vi.mock('@/store', () => ({
  useAppStore: (select: (state: unknown) => unknown) =>
    select({ openSettingsTarget, openSettingsPage })
}))

const row = (id: string, over: Partial<NewTabAccountRow> = {}): NewTabAccountRow => ({
  id,
  email: `${id}@example.test`,
  disabled: null,
  inUseBy: [],
  otherModel: false,
  usedPercent: 10,
  ...over
})

const PICKER: AgentRowAccount = {
  kind: 'picker',
  provider: 'claude',
  rows: [row('acct-free'), row('acct-2', { inUseBy: ['ORCA-3'] })],
  checkedId: 'acct-free'
}
const TODO = [{ identifier: 'ORCA-9', title: 'Fix the menu', prompt: 'Work on ORCA-9' }]
const LIVE = {
  kind: 'lead-live',
  leadName: 'Alfred',
  lead: {
    paneKey: 'tab-1:pane-1',
    terminalHandle: 'term_lead',
    worktreeId: 'wt',
    host: { kind: 'local' }
  },
  todo: TODO,
  memberAgent: 'claude'
} as const
const CLOSED = { kind: 'lead-closed', accountId: 'acct-glm' } as const

function renderMenu(over: Partial<NewTabTeamMenuItemsProps>) {
  const props: NewTabTeamMenuItemsProps = {
    state: LIVE,
    account: PICKER,
    labelOf: (_provider, id) => (id === 'acct-glm' ? 'Claude GLM' : `Account ${id}`),
    onGoToLead: vi.fn(),
    onAddMember: vi.fn(),
    onReopen: vi.fn(),
    onStartFresh: vi.fn(),
    ...over
  }
  render(
    <DropdownMenu open modal={false}>
      <DropdownMenuTrigger>+</DropdownMenuTrigger>
      <DropdownMenuContent>
        <NewTabTeamMenuItems {...props} />
      </DropdownMenuContent>
    </DropdownMenu>
  )
  return props
}

const item = (name: string | RegExp) => screen.getByRole('menuitem', { name })

afterEach(cleanup)

// Why (ORCA-717): a project with a team offers its lead, never a second team.
describe('NewTabTeamMenuItems', () => {
  it('goes to the live lead by name under a Team heading', () => {
    const props = renderMenu({})

    expect(screen.getByText('Team')).toBeTruthy()
    fireEvent.click(item('Go to lead Alfred'))

    expect(props.onGoToLead).toHaveBeenCalledTimes(1)
  })

  it('says Go to lead when the panel has not read the lead name', () => {
    renderMenu({ state: { ...LIVE, leadName: null } })

    expect(item('Go to lead')).toBeTruthy()
  })

  it('adds a member for a To Do ticket on the member pick, or the account picked beside it', () => {
    const props = renderMenu({})

    fireEvent.click(item('Add a member to the team…'))
    fireEvent.click(item(/ORCA-9/))
    expect(props.onAddMember).toHaveBeenLastCalledWith(TODO[0], 'acct-free')

    fireEvent.click(item("Choose the member's account"))
    fireEvent.click(item(/Account acct-2/))
    fireEvent.click(item('Add a member to the team…'))
    fireEvent.click(item(/ORCA-9/))
    expect(props.onAddMember).toHaveBeenLastCalledWith(TODO[0], 'acct-2')
  })

  it("heads the account list with its provider and links to that provider's accounts", () => {
    renderMenu({})

    fireEvent.click(item("Choose the member's account"))
    expect(screen.getByText('Claude accounts')).toBeTruthy()
    fireEvent.click(item('Manage accounts…'))

    expect(openSettingsTarget).toHaveBeenCalledWith({
      pane: 'accounts',
      repoId: null,
      sectionId: 'accounts-claude'
    })
    expect(openSettingsPage).toHaveBeenCalledTimes(1)
  })

  it('says To Do is empty instead of offering no ticket', () => {
    renderMenu({ state: { ...LIVE, todo: [] } })

    fireEvent.click(item('Add a member to the team…'))

    expect(item('To Do is empty').getAttribute('aria-disabled')).toBe('true')
  })

  it("adds a member on the host's own login with no picker off this machine", () => {
    const props = renderMenu({ account: { kind: 'host-login' } })

    expect(screen.queryByRole('menuitem', { name: /Choose the/ })).toBeNull()
    expect(screen.getByText('Host login')).toBeTruthy()
    fireEvent.click(item('Add a member to the team…'))
    fireEvent.click(item(/ORCA-9/))

    expect(props.onAddMember).toHaveBeenCalledWith(TODO[0], null)
  })

  it('reopens the team on the account the kept lead runs on, with no picker', () => {
    const props = renderMenu({ state: CLOSED })

    const reopen = item(/Reopen team/)
    expect(within(reopen).getByText('Claude GLM')).toBeTruthy()
    // Why one picker: only Start fresh launches on a chosen account; Reopen keeps the lead's.
    expect(
      screen
        .getAllByRole('menuitem', { name: /Choose the/ })
        .map((one) => one.getAttribute('aria-label'))
    ).toEqual(["Choose the lead's account"])
    fireEvent.click(reopen)

    expect(props.onReopen).toHaveBeenCalledTimes(1)
  })

  it('starts a fresh lead only once confirmed in the menu, on the picked account', () => {
    const props = renderMenu({ state: CLOSED })

    fireEvent.click(item('Start fresh lead…'))
    expect(props.onStartFresh).not.toHaveBeenCalled()
    expect(screen.getByText('Start a fresh lead?')).toBeTruthy()

    fireEvent.click(item('Cancel'))
    expect(item('Start fresh lead…')).toBeTruthy()

    fireEvent.click(item('Start fresh lead…'))
    fireEvent.click(item('Start'))
    expect(props.onStartFresh).toHaveBeenCalledWith('acct-free')
  })
})
