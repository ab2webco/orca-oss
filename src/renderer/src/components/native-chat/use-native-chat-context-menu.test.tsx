import React, { createRef } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/components/ui/dropdown-menu', async () => {
  const React_ = await import('react')
  const passthrough = ({ children }: { children?: React.ReactNode }) =>
    React_.createElement(React_.Fragment, null, children)
  return {
    DropdownMenu: passthrough,
    DropdownMenuContent: passthrough,
    DropdownMenuItem: passthrough,
    DropdownMenuSeparator: () => null,
    DropdownMenuShortcut: passthrough,
    DropdownMenuTrigger: passthrough
  }
})
vi.mock('@/i18n/i18n', () => ({ translate: (_key: string, fallback: string) => fallback }))
vi.mock('./native-chat-shortcut', () => ({
  isMacPlatform: () => false,
  nativeChatToggleShortcutLabel: () => 'Ctrl+/'
}))
vi.mock('../terminal-pane/TerminalClaudeAccountSwitchMenu', () => ({
  TerminalClaudeAccountSwitchMenu: () => <span data-testid="switch-account-submenu" />
}))

import {
  useNativeChatContextMenu,
  emptyNativeChatContextMenuActions,
  type NativeChatContextMenuActions
} from './use-native-chat-context-menu'

function renderMenu(overrides: Partial<NativeChatContextMenuActions>): string {
  const actions: NativeChatContextMenuActions = {
    onPaste: vi.fn(),
    ...emptyNativeChatContextMenuActions,
    ...overrides
  }
  function Harness(): React.JSX.Element {
    const { menu } = useNativeChatContextMenu({
      rootRef: createRef<HTMLElement>(),
      actions
    })
    return menu
  }
  return renderToStaticMarkup(<Harness />)
}

describe('useNativeChatContextMenu — switch account action', () => {
  it('renders the switch-account submenu when the pane hosts a Claude session', () => {
    const markup = renderMenu({
      canSwitchClaudeAccount: true,
      onSwitchClaudeAccount: vi.fn()
    })

    expect(markup).toContain('data-testid="switch-account-submenu"')
  })

  it('omits the switch-account submenu when the pane is not a Claude session', () => {
    const markup = renderMenu({ canSwitchClaudeAccount: false })

    expect(markup).not.toContain('data-testid="switch-account-submenu"')
  })
})
