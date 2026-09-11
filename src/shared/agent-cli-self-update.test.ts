import { describe, expect, it } from 'vitest'
import {
  AGENT_CLI_SELF_UPDATE_REPAIRS,
  getAgentCliSelfUpdateRepair,
  getRepairableAgentCliIds,
  REPAIRABLE_AGENT_CLI_IDS
} from './agent-cli-self-update'
import { TUI_AGENT_CONFIG } from './tui-agent-config'

describe('agent CLI self-update repairs', () => {
  it('only offers a repair for agents that exist in the catalog', () => {
    // Why: el boton corre comandos contra el host. Un id que no este en el
    // catalogo significa que el recipe apunta a un CLI que Orca ni detecta.
    for (const agentId of REPAIRABLE_AGENT_CLI_IDS) {
      expect(TUI_AGENT_CONFIG[agentId]).toBeDefined()
    }
  })

  it('has a recipe for every id it advertises as repairable', () => {
    for (const agentId of getRepairableAgentCliIds()) {
      expect(getAgentCliSelfUpdateRepair(agentId)).not.toBeNull()
    }
    expect(Object.keys(AGENT_CLI_SELF_UPDATE_REPAIRS).sort()).toEqual(
      [...REPAIRABLE_AGENT_CLI_IDS].sort()
    )
  })

  it('refuses to repair an agent with no documented per-user install path', () => {
    // Deliberado: un `npm i -g` a ciegas sobre un CLI que alguien instalo con
    // brew o con un binario suelto rompe mas de lo que arregla.
    expect(getAgentCliSelfUpdateRepair('autohand')).toBeNull()
  })

  it('keeps the codex recipe pinned to its published package', () => {
    expect(getAgentCliSelfUpdateRepair('codex')).toEqual({
      kind: 'npm-user-prefix',
      packageName: '@openai/codex'
    })
  })
})
