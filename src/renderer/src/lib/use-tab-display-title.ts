import { stripLeadingAgentTitleDecoration } from '../../../shared/agent-title-decoration'
import type { TerminalTab } from '../../../shared/terminal-tab-types'
import type { TuiAgent } from '../../../shared/tui-agent'
import { memberTabTitleForDisplay } from './member-tab-title-display'
import { useLocalHostName } from './use-local-host-name'

/** A terminal tab's label: the user's title, else the live one, with this machine named (ORCA-1149). */
export function useTabDisplayTitle(tab: TerminalTab, agent: TuiAgent | null): string {
  // Why: with a provider icon shown, strip the agent's own leading glyph so the tab doesn't show two icons for one agent.
  const title = tab.customTitle ?? (agent ? stripLeadingAgentTitleDecoration(tab.title) : tab.title)
  return memberTabTitleForDisplay(title, useLocalHostName())
}
