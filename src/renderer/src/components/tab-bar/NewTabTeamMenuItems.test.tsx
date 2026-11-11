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
    fireEvent.click(item('Go to lead · Alfred'))

    expect(props.onGoToLead).toHaveBeenCalledTimes(1)
  })

  it('says Go to lead when the panel has not read the lead name', () => {
    renderMenu({ state: { ...LIVE, leadName: null } })

    expect(item('Go to lead')).toBeTruthy()
  })

  // Why (ORCA-717): a generic lead name is the role again; the row says it once.
  it('drops a generic lead name so the row does not repeat the word', () => {
    renderMenu({ state: { ...LIVE, leadName: 'Lead' } })

    expect(item('Go to lead')).toBeTruthy()
    expect(screen.queryByText('Lead')).toBeNull()
  })

  it('mutes the lead name after a separator', () => {
    renderMenu({})

    expect(within(item('Go to lead · Alfred')).getByText(/Alfred/).className).toContain(
      'text-muted-foreground'
    )
  })

  // Why: beside the row, the account's chevron doubled the row's and truncated its label.
  // Why: icon-less Team rows broke the left edge the Terminal and Agents rows keep.
  it('leads each Team row with its icon, as the Terminal and Agents rows do', () => {
    renderMenu({})
    expect(item('Go to lead · Alfred').querySelector('svg.lucide-crown')).toBeTruthy()
    expect(item('Add member…').querySelector('svg.lucide-user-plus')).toBeTruthy()
    cleanup()

    renderMenu({ state: CLOSED })
    expect(item(/^Reopen team/).querySelector('svg.lucide-rotate-ccw')).toBeTruthy()
    expect(item('Start fresh lead…').querySelector('svg.lucide-plus')).toBeTruthy()
  })

  it('keeps the add-member row to its label and one chevron, the account inside its submenu', () => {
    renderMenu({})

    expect(screen.queryByRole('menuitem', { name: "Choose the member's account" })).toBeNull()
    fireEvent.click(item('Add member…'))

    expect(item("Choose the member's account")).toBeTruthy()
  })

  // Why (ORCA-717): a long email cut to 'name@ko…' read as broken; the trigger names it short.
  it("names the member's account by its short form, the full email on hover and in its list", () => {
    renderMenu({ labelOf: (_provider, id) => `${id}.long.name@example.test` })

    fireEvent.click(item('Add member…'))
    const trigger = item("Choose the member's account")
    expect(trigger.textContent).toBe('acct-free.long.name')
    expect(trigger.getAttribute('title')).toBe('acct-free.long.name@example.test')

    fireEvent.click(trigger)
    const label = within(item(/acct-2\.long\.name/)).getByText('acct-2.long.name@example.test')
    expect(label.className).toContain('break-all')
    expect(label.className).not.toContain('truncate')
  })

  it('adds a member for a To Do ticket on the member pick, or the account picked in its submenu', () => {
    const props = renderMenu({})

    fireEvent.click(item('Add member…'))
    fireEvent.click(item(/ORCA-9/))
    expect(props.onAddMember).toHaveBeenLastCalledWith(TODO[0], 'acct-free')

    fireEvent.click(item('Add member…'))
    fireEvent.click(item("Choose the member's account"))
    fireEvent.click(item(/Account acct-2/))
    fireEvent.click(item(/ORCA-9/))
    expect(props.onAddMember).toHaveBeenLastCalledWith(TODO[0], 'acct-2')
  })

  it("heads the account list with its provider and links to that provider's accounts", () => {
    renderMenu({})

    fireEvent.click(item('Add member…'))
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

    fireEvent.click(item('Add member…'))

    expect(item('To Do is empty').getAttribute('aria-disabled')).toBe('true')
  })

  it("adds a member on the host's own login with no picker off this machine", () => {
    const props = renderMenu({ account: { kind: 'host-login' } })

    expect(screen.queryByText('Host login')).toBeNull()
    fireEvent.click(item('Add member…'))
    expect(screen.queryByRole('menuitem', { name: /Choose the/ })).toBeNull()
    expect(screen.getByText('Host login')).toBeTruthy()
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
