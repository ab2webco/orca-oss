import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { QuickLaunchAgentMenuItems, type QuickLaunchAgentAccounts } from './QuickLaunchButton'
import { launchAgentInNewTab } from '@/lib/launch-agent-in-new-tab'

const { shortcutLabelMock, storeState, useDetectedAgentsMock, selectables } = vi.hoisted(() => ({
  shortcutLabelMock: vi.fn<() => string | null>(),
  storeState: {
    settings: {
      defaultTuiAgent: 'codex' as 'claude' | 'codex' | 'gemini' | 'blank' | null,
      disabledTuiAgents: [] as string[]
    },
    worktreesByRepo: {} as Record<string, unknown[]>,
    repos: [] as unknown[],
    openSettingsPage: vi.fn(),
    openSettingsTarget: vi.fn()
  },
  useDetectedAgentsMock: vi.fn(() => ({ detectedIds: ['claude', 'codex', 'gemini'] })),
  selectables: [] as { title: string | null; onSelect?: () => void }[]
}))

vi.mock('@/hooks/useDetectedAgents', () => ({
  useDetectedAgents: useDetectedAgentsMock
}))

vi.mock('@/hooks/useShortcutLabel', () => ({
  useOptionalShortcutLabel: shortcutLabelMock
}))

vi.mock('@/store', () => {
  const useAppStore = Object.assign(
    (selector: (state: typeof storeState) => unknown) => {
      return selector(storeState)
    },
    {
      getState: () => storeState
    }
  )

  return { useAppStore }
})

vi.mock('@/lib/agent-catalog', async () => {
  const ReactActual = (await vi.importActual('react')) as {
    createElement: typeof React.createElement
  }

  return {
    getAgentCatalog: () => [
      { id: 'claude', label: 'Claude' },
      { id: 'codex', label: 'Codex' },
      { id: 'gemini', label: 'Gemini' }
    ],
    AgentIcon: ({ agent }: { agent: string }) => ReactActual.createElement('span', null, agent)
  }
})

vi.mock('@/components/ui/dropdown-menu', async () => {
  const ReactActual = (await vi.importActual('react')) as {
    createElement: typeof React.createElement
  }

  const passThrough = ({ children }: { children: React.ReactNode }) =>
    ReactActual.createElement('div', null, children)
  return {
    DropdownMenuItem: ({
      children,
      onSelect,
      ...props
    }: {
      children: React.ReactNode
      onSelect?: () => void
      title?: string
    }) => {
      selectables.push({ title: props.title ?? null, onSelect })
      return ReactActual.createElement('div', props, children)
    },
    DropdownMenuShortcut: ({ children }: { children: React.ReactNode }) =>
      ReactActual.createElement('span', { 'data-dropdown-shortcut': 'true' }, children),
    DropdownMenuLabel: passThrough,
    DropdownMenuSeparator: () => null,
    DropdownMenuSub: passThrough,
    DropdownMenuSubContent: passThrough,
    DropdownMenuSubTrigger: ({
      children,
      ...props
    }: {
      children: React.ReactNode
      'aria-label'?: string
    }) => ReactActual.createElement('div', { 'data-sub-trigger': props['aria-label'] }, children)
  }
})

vi.mock('@/i18n/i18n', () => ({
  translate: (_key: string, fallback: string, values?: Record<string, string>) =>
    Object.entries(values ?? {}).reduce(
      (text, [key, value]) => text.replace(`{{${key}}}`, value),
      fallback
    )
}))

vi.mock('sonner', () => ({
  toast: {
    error: vi.fn(),
    message: vi.fn()
  }
}))

vi.mock('@/lib/launch-agent-in-new-tab', () => ({
  launchAgentInNewTab: vi.fn()
}))

const pinRow = {
  id: 'acct-pin',
  email: 'pin@example.test',
  disabled: null,
  inUseBy: ['NETSA-121'],
  otherModel: false,
  usedPercent: 40
}
const glmRow = { ...pinRow, id: 'acct-glm', inUseBy: [], otherModel: true, usedPercent: null }

function accounts(local = true): QuickLaunchAgentAccounts {
  return {
    local,
    providers: {
      claude: {
        choice: { kind: 'picker', defaultId: 'acct-pin', rows: [pinRow, glmRow] },
        resolvedId: 'acct-pin'
      },
      codex: null
    },
    labelOf: (_provider, id) => (id === 'acct-glm' ? 'Claude GLM' : (id ?? 'System login'))
  }
}

function render(agentAccounts?: QuickLaunchAgentAccounts, hiddenAgents?: 'codex'[]): string {
  selectables.length = 0
  return renderToStaticMarkup(
    React.createElement(QuickLaunchAgentMenuItems, {
      worktreeId: 'worktree-1',
      groupId: 'group-1',
      onFocusTerminal: vi.fn(),
      ...(agentAccounts ? { agentAccounts } : {}),
      ...(hiddenAgents ? { hiddenAgents } : {})
    })
  )
}

const select = (title: string | null, index = 0): void => {
  const found = selectables.filter((item) => item.title === title)[index]
  expect(found?.onSelect).toBeDefined()
  found?.onSelect?.()
}

// Why (ORCA-717): the + menu names each agent's login; only a hand pick changes the launch account.
describe('QuickLaunchAgentMenuItems accounts', () => {
  beforeEach(() => {
    vi.mocked(launchAgentInNewTab).mockReset()
    useDetectedAgentsMock.mockReturnValue({ detectedIds: ['claude', 'codex', 'gemini'] })
  })

  it("shows Claude's resolved account beside the row, with its picker", () => {
    const html = render(accounts())

    expect(html).toContain('data-sub-trigger="Choose the Claude account"')
    expect(html).toContain('acct-pin')
    expect(html).toContain('In use by NETSA-121')
    expect(html).toContain('Other model')
  })

  it('launches on a hand-picked Claude account', () => {
    render(accounts())

    select(null, 1)

    expect(launchAgentInNewTab).toHaveBeenCalledWith(
      expect.objectContaining({ agent: 'claude', claudeAccountId: 'acct-glm' })
    )
  })

  it('launches the plain row with no account, exactly as before', () => {
    render(accounts())

    select('Launch Claude in a new terminal')

    const args = vi.mocked(launchAgentInNewTab).mock.calls.at(-1)?.[0]
    expect(args).toMatchObject({ agent: 'claude' })
    expect(args).not.toHaveProperty('claudeAccountId')
    expect(args).not.toHaveProperty('codexAccountId')
  })

  it('shows Own login for an agent with no managed accounts', () => {
    expect(render(accounts())).toContain('Own login')
  })

  it("shows the host's login and no picker off this host", () => {
    const html = render(accounts(false))

    expect(html).toContain('Host login')
    expect(html).not.toContain('data-sub-trigger')
  })

  // Why: a project with a lead offers its Team rows, not Claude Agent Teams' second team.
  it('leaves out the agents the menu hides, and keeps every row otherwise', () => {
    expect(render(accounts(), ['codex'])).not.toContain('Launch Codex in a new terminal')
    expect(render(accounts())).toContain('Launch Codex in a new terminal')
  })

  it('keeps plain rows in a menu that passes no account context', () => {
    const html = render()

    expect(html).not.toContain('Own login')
    expect(html).not.toContain('data-sub-trigger')
  })
})
