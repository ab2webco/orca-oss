import { describe, expect, it } from 'vitest'
import type { OrchestratorGameAction } from './orchestrator-game-actions'
import { resolveOrchestratorGameIntegrations } from './orchestrator-game-config'
import {
  gameMachineActionsOf,
  parseGameMachineActions,
  withGameMachineActions
} from './orchestrator-game-machine-actions'

const YAML: OrchestratorGameAction[] = [
  { label: 'Release', command: 'release', icon: 'tag', pin: true, prompt: 'Prepare it' },
  { label: 'Board', command: 'board', mcp: { server: 'plane', tool: 'list' } }
]

describe("this machine's project actions, merged by command over orca.yaml's", () => {
  it("keeps orca.yaml's first, replaces one by command in place, hides one, then adds this machine's", () => {
    expect(
      withGameMachineActions(YAML, [
        { label: 'Deploy', command: 'deploy', prompt: 'Ship it' },
        { label: 'Release', command: 'release', icon: 'tag', prompt: 'Prepare it' },
        { command: 'board', enabled: false }
      ])
    ).toEqual([
      { label: 'Release', command: 'release', icon: 'tag', prompt: 'Prepare it' },
      { label: 'Deploy', command: 'deploy', prompt: 'Ship it' }
    ])
  })

  it('reads a hidden entry only with a valid command, and the rest as actions', () => {
    const parsed = parseGameMachineActions([
      { command: 'board', enabled: false },
      { command: 'Not A Command', enabled: false },
      { label: 'Deploy', command: 'deploy', prompt: 'Ship it' }
    ])
    expect(parsed.value).toEqual([
      { label: 'Deploy', command: 'deploy', prompt: 'Ship it' },
      { command: 'board', enabled: false }
    ])
    expect(parsed.warnings).toHaveLength(1)
  })

  it('turns an old full copy of orca.yaml with one row flipped into that one change', () => {
    const flipped = YAML.map((one) => (one.command === 'board' ? { ...one, pin: true } : one))
    expect(gameMachineActionsOf(YAML, flipped)).toEqual([{ ...YAML[1], pin: true }])
    expect(gameMachineActionsOf(YAML, [YAML[0]!])).toEqual([{ command: 'board', enabled: false }])
    expect(gameMachineActionsOf(YAML, [...YAML])).toEqual([])
  })

  it('resolves an old file and old machine list as before, and machineActions over them', () => {
    const old = { project: { actions: YAML }, local: { actions: [YAML[1]!] } }
    expect(resolveOrchestratorGameIntegrations(old).actions).toEqual([YAML[1]])
    expect(
      resolveOrchestratorGameIntegrations({
        project: { actions: YAML },
        local: { machineActions: [{ command: 'release', enabled: false }] }
      }).actions
    ).toEqual([YAML[1]])
  })
})
