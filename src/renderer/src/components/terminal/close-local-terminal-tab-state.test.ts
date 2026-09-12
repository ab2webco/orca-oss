import { beforeEach, describe, expect, it, vi } from 'vitest'
import { closeLocalTerminalTabState } from './close-local-terminal-tab-state'

const WORKTREE = 'worktree-1'
const TAB = '11111111-1111-4111-8111-111111111111'
const LEAF = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const PANE_KEY = `${TAB}:${LEAF}`

const clearSleepingAgentSession = vi.fn()
const closeTab = vi.fn()
let sleepingAgentSessionsByPaneKey: Record<string, { paneKey: string }> = {}

vi.mock('@/store', () => ({
  useAppStore: {
    getState: () => ({
      sleepingAgentSessionsByPaneKey,
      clearSleepingAgentSession,
      closeTab,
      tabsByWorktree: { [WORKTREE]: [{ id: TAB }] },
      unifiedTabsByWorktree: {}
    })
  }
}))

beforeEach(() => {
  clearSleepingAgentSession.mockReset()
  closeTab.mockReset()
  sleepingAgentSessionsByPaneKey = { [PANE_KEY]: { paneKey: PANE_KEY } }
})

describe('closeLocalTerminalTabState sleeping-agent retirement', () => {
  it('drops the record when the user closes the tab by hand', () => {
    // El caso que #384 arreglo: el agente ya salio, el usuario cierra el tab, y sin
    // borrar el registro la siguiente hidratacion en frio lo relanza gastando cuota.
    closeLocalTerminalTabState(TAB)

    expect(clearSleepingAgentSession).toHaveBeenCalledWith(PANE_KEY)
    expect(closeTab).toHaveBeenCalledWith(TAB)
  })

  it('keeps the record when the runtime closed the tab', () => {
    // Un cierre por CLI/RPC no es el usuario dando fe de que el agente termino: el
    // store ya lo distingue asi (`retiresAgentSessions`, terminals.ts), y borrar aqui
    // le sacaba al worker retirado su autoridad de resume antes de llegar a esa regla.
    closeLocalTerminalTabState(TAB, { runtimeInitiated: true })

    expect(clearSleepingAgentSession).not.toHaveBeenCalled()
    expect(closeTab).toHaveBeenCalledWith(TAB, { runtimeInitiated: true })
  })

  it('keeps the record when the pty exited on its own', () => {
    closeLocalTerminalTabState(TAB, { reason: 'pty-exit', retainSleepingAgents: true })

    expect(clearSleepingAgentSession).not.toHaveBeenCalled()
    expect(closeTab).toHaveBeenCalledWith(TAB, { reason: 'pty-exit' })
  })
})
