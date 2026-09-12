import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  useIpcEventsForCloseRouting,
  type CloseTerminalListener
} from './ipc-events-close-routing-test-harness'

const WORKTREE = 'wt-1'
const TAB = '11111111-1111-4111-8111-111111111111'
const PANE_KEY = `${TAB}:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa`

let sleepingAgentSessionsByPaneKey: Record<string, { paneKey: string }> = {}
const closeTab = vi.fn()

// Why un clear real y no un spy: la asercion de este archivo va sobre el registro que
// sobrevive, no sobre las opciones con las que se llamo a cerrar — un spy pasaria igual
// contra el codigo viejo si algun eslabon de la cadena ignorara la marca.
function harnessState(): Record<string, unknown> {
  return {
    tabsByWorktree: { [WORKTREE]: [{ id: TAB }] },
    unifiedTabsByWorktree: {},
    sleepingAgentSessionsByPaneKey,
    clearSleepingAgentSession: (paneKey: string) => {
      delete sleepingAgentSessionsByPaneKey[paneKey]
    },
    closeTab,
    activeWorktreeId: WORKTREE,
    activeTabId: TAB,
    openFiles: [],
    browserTabsByWorktree: {},
    settings: { activeRuntimeEnvironmentId: null, terminalFontSize: 13 }
  }
}

describe('legacy onCloseTerminal fallback', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.unstubAllGlobals()
    closeTab.mockReset()
    sleepingAgentSessionsByPaneKey = { [PANE_KEY]: { paneKey: PANE_KEY } }
  })

  it('keeps the sleeping-agent record when the runtime closes the tab', async () => {
    const closeTerminalListenerRef: { current: CloseTerminalListener | null } = { current: null }
    await useIpcEventsForCloseRouting({ closeTerminalListenerRef, getState: harnessState })

    // Sin este chequeo, un listener nunca registrado dejaria pasar el test sin cerrar nada.
    expect(closeTerminalListenerRef.current).not.toBeNull()
    closeTerminalListenerRef.current?.({ tabId: TAB })

    expect(Object.keys(sleepingAgentSessionsByPaneKey)).toEqual([PANE_KEY])
    expect(closeTab).toHaveBeenCalled()
  })

  it('still drops the record when the user closes the same tab by hand', async () => {
    // Sin este caso el anterior no prueba nada: demuestra que esta cadena SI borra el
    // registro cuando nadie marca el cierre como del runtime (#384, orca-contabo).
    await useIpcEventsForCloseRouting({ getState: harnessState })
    const { closeTerminalTab } = await import('@/components/terminal/terminal-tab-actions')

    closeTerminalTab(TAB)

    expect(sleepingAgentSessionsByPaneKey).toEqual({})
  })
})
