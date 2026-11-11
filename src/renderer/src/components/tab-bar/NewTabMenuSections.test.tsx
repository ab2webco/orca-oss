// @vitest-environment happy-dom

import React from 'react'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import type { NewTabTeamMenuState } from './new-tab-team-menu-state'
import { NewTabMenuSections } from './NewTabMenuSections'

let teamState: NewTabTeamMenuState = { kind: 'no-team' }
const hiddenAgentsSeen: unknown[] = []

vi.mock('./use-new-tab-agent-accounts', () => ({
  useNewTabAgentAccounts: () => ({
    local: true,
    providers: { claude: null, codex: null },
    labelOf: () => 'Account'
  })
}))
vi.mock('./use-new-tab-team-menu', () => ({
  useNewTabTeamMenu: () => ({
    state: teamState,
    projectName: 'orca-oss',
    target: { kind: 'local' }
  })
}))
vi.mock('./use-new-tab-team-actions', () => ({
  useNewTabTeamActions: () => ({
    onGoToLead: vi.fn(),
    onAddMember: vi.fn(),
    onReopen: vi.fn(),
    onStartFresh: vi.fn()
  })
}))
vi.mock('./QuickLaunchButton', () => ({
  QuickLaunchAgentMenuItems: (props: { hiddenAgents?: unknown }) => {
    hiddenAgentsSeen.push(props.hiddenAgents)
    return <div role="menuitem">Claude</div>
  }
}))

const LIVE: NewTabTeamMenuState = {
  kind: 'lead-live',
  leadName: 'Alfred',
  lead: { paneKey: 'p', terminalHandle: 't', worktreeId: 'w', host: { kind: 'local' } },
  todo: [],
  memberAgent: 'claude'
}

function renderSections(): void {
  render(
    <DropdownMenu open modal={false}>
      <DropdownMenuTrigger>+</DropdownMenuTrigger>
      <DropdownMenuContent>
        <NewTabMenuSections worktreeId="wt-1" groupId="g-1" onFocusTerminal={vi.fn()}>
          <DropdownMenuItem>New terminal</DropdownMenuItem>
        </NewTabMenuSections>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

// Why from the text: the headings in the order the menu draws them.
const headings = (): string[] => {
  const text = document.body.textContent ?? ''
  return ['Team', 'Terminal', 'Agents']
    .filter((name) => screen.queryByText(name) !== null)
    .toSorted((a, b) => text.indexOf(a) - text.indexOf(b))
}

beforeEach(() => {
  teamState = { kind: 'no-team' }
  hiddenAgentsSeen.length = 0
})
afterEach(cleanup)

// Why (ORCA-717): the + menu reads Team, Terminal, Agents, and never offers a second team.
describe('NewTabMenuSections', () => {
  it("keeps today's menu, under Terminal and Agents headings, for a project with no team", () => {
    renderSections()

    expect(headings()).toEqual(['Terminal', 'Agents'])
    expect(screen.getByRole('menuitem', { name: 'New terminal' })).toBeTruthy()
    expect(hiddenAgentsSeen.at(-1)).toEqual([])
  })

  it('puts the Team group first and drops Claude Agent Teams while a lead is live', () => {
    teamState = LIVE
    renderSections()

    expect(headings()).toEqual(['Team', 'Terminal', 'Agents'])
    expect(screen.getByRole('menuitem', { name: 'Go to lead Alfred' })).toBeTruthy()
    expect(hiddenAgentsSeen.at(-1)).toEqual(['claude-agent-teams'])
  })

  it('offers no team rows and no second team while the lead restores', () => {
    teamState = { kind: 'pending' }
    renderSections()

    expect(headings()).toEqual(['Terminal', 'Agents'])
    expect(hiddenAgentsSeen.at(-1)).toEqual(['claude-agent-teams'])
  })
})
