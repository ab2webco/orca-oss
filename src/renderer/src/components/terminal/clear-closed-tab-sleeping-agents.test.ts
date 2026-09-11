import { beforeEach, describe, expect, it, vi } from 'vitest'
import { clearSleepingAgentSessionsForClosedTab } from './clear-closed-tab-sleeping-agents'

const TAB = '11111111-1111-4111-8111-111111111111'
const OTHER_TAB = '22222222-2222-4222-8222-222222222222'
const LEAF_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const LEAF_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'

const clearSleepingAgentSession = vi.fn()
let sleepingAgentSessionsByPaneKey: Record<string, { paneKey: string }> = {}

vi.mock('@/store', () => ({
  useAppStore: {
    getState: () => ({
      sleepingAgentSessionsByPaneKey,
      clearSleepingAgentSession
    })
  }
}))

function paneKey(tabId: string, leafId: string): string {
  return `${tabId}:${leafId}`
}

beforeEach(() => {
  clearSleepingAgentSession.mockReset()
  sleepingAgentSessionsByPaneKey = {
    [paneKey(TAB, LEAF_A)]: { paneKey: paneKey(TAB, LEAF_A) },
    [paneKey(TAB, LEAF_B)]: { paneKey: paneKey(TAB, LEAF_B) },
    [paneKey(OTHER_TAB, LEAF_A)]: { paneKey: paneKey(OTHER_TAB, LEAF_A) }
  }
})

describe('clearSleepingAgentSessionsForClosedTab', () => {
  it('drops every sleeping-agent record belonging to the closed tab', () => {
    // Si el registro sobrevive, `resumeSleepingAgentSessionsForWorktree` lo
    // relanza en la siguiente hidratacion en frio: el usuario cierra la
    // terminal, recarga, y el agente esta corriendo otra vez.
    clearSleepingAgentSessionsForClosedTab(TAB)

    expect(clearSleepingAgentSession.mock.calls.map(([key]) => key).sort()).toEqual(
      [paneKey(TAB, LEAF_A), paneKey(TAB, LEAF_B)].sort()
    )
  })

  it('leaves other tabs alone', () => {
    clearSleepingAgentSessionsForClosedTab(TAB)

    expect(clearSleepingAgentSession).not.toHaveBeenCalledWith(paneKey(OTHER_TAB, LEAF_A))
  })

  it('keeps the records when the pty exited on its own', () => {
    // Ahi el proceso termino solo, que es el caso para el que la hibernacion
    // existe. Lo que no puede sobrevivir es un cierre que pidio el usuario.
    clearSleepingAgentSessionsForClosedTab(TAB, 'pty-exit')

    expect(clearSleepingAgentSession).not.toHaveBeenCalled()
  })

  it('clears on a user close even when a reason is given', () => {
    clearSleepingAgentSessionsForClosedTab(TAB, 'user')

    expect(clearSleepingAgentSession).toHaveBeenCalledTimes(2)
  })

  it('ignores pane keys it cannot parse', () => {
    sleepingAgentSessionsByPaneKey = { 'not-a-pane-key': { paneKey: 'not-a-pane-key' } }

    expect(() => clearSleepingAgentSessionsForClosedTab(TAB)).not.toThrow()
    expect(clearSleepingAgentSession).not.toHaveBeenCalled()
  })
})
