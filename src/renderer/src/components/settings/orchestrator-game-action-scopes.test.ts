import { describe, expect, it } from 'vitest'
import type { OrchestratorGameAction } from '../../../../shared/orchestrator-game-actions'
import {
  scopedListsOf,
  scopedRowsOf,
  withMovedUp,
  withRemovedAction,
  withSavedAction
} from './orchestrator-game-action-scopes'

const release: OrchestratorGameAction = {
  label: 'Release',
  command: 'release',
  pin: true,
  prompt: 'Prepare it'
}
const board: OrchestratorGameAction = { label: 'Board', command: 'board', prompt: 'Read it' }
const deploy: OrchestratorGameAction = { label: 'Deploy', command: 'deploy', prompt: 'Ship it' }
const YAML = [release, board]

const scopes = (lists: ReturnType<typeof scopedListsOf>) =>
  scopedRowsOf(lists).map((row) => `${row.action.command}:${row.scope}`)

describe("Settings > Actions edits orca.yaml's list and this machine's changes apart, as V30", () => {
  it("reads an old whole-list override as the changes it made, its rows still this machine's", () => {
    const lists = scopedListsOf(YAML, { actions: [release, { ...board, pin: true }] })
    expect(lists.machine).toEqual([{ ...board, pin: true }])
    expect(scopes(lists)).toEqual(['release:machine', 'board:machine'])
    const saved = withSavedAction(lists, { ...release, pin: false }, 'machine', release)
    expect(saved).toEqual({
      project: YAML,
      machine: [
        { ...board, pin: true },
        { ...release, pin: false }
      ]
    })
    expect(scopes(saved)).toEqual(['release:machine', 'board:machine'])
  })

  it('saves a new action first in the source its switch picks', () => {
    const lists = scopedListsOf(YAML, undefined)
    expect(withSavedAction(lists, deploy, 'project', null).project).toEqual([deploy, ...YAML])
    const mine = withSavedAction(lists, deploy, 'machine', null)
    expect(mine).toEqual({ project: YAML, machine: [deploy] })
    expect(scopes(mine)).toEqual(['release:project', 'board:project', 'deploy:machine'])
  })

  it('keeps orca.yaml as it is when an orca.yaml row moves to this machine, and back', () => {
    const lists = scopedListsOf(YAML, undefined)
    const changed = { ...board, prompt: 'Only mine' }
    const mine = withSavedAction(lists, changed, 'machine', board)
    expect(mine).toEqual({ project: YAML, machine: [changed] })
    expect(withSavedAction(mine, changed, 'project', changed)).toEqual({
      project: [release, changed],
      machine: []
    })
    const renamed = withSavedAction(lists, { ...board, command: 'plane' }, 'machine', board)
    expect(scopedRowsOf(renamed).map((row) => row.action.command)).toEqual(['release', 'plane'])
  })

  it("edits this machine's action where it stands, so a pin flip keeps the order", () => {
    const two = withSavedAction(
      withSavedAction(scopedListsOf(YAML, undefined), deploy, 'machine', null),
      { ...board, command: 'plane' },
      'machine',
      null
    )
    const plane = { ...board, command: 'plane', pin: true }
    const flipped = withSavedAction(two, plane, 'machine', two.machine[0] as OrchestratorGameAction)
    expect(flipped.machine).toEqual([plane, deploy])
  })

  it('removes from orca.yaml, or hides on this machine only, as the switch says', () => {
    const lists = scopedListsOf(YAML, undefined)
    expect(withRemovedAction(lists, board, 'project')).toEqual({ project: [release], machine: [] })
    const hidden = withRemovedAction(lists, board, 'machine')
    expect(hidden).toEqual({ project: YAML, machine: [{ command: 'board', enabled: false }] })
    expect(scopes(hidden)).toEqual(['release:project'])
    const mine = withSavedAction(lists, deploy, 'machine', null)
    expect(withRemovedAction(mine, deploy, 'machine')).toEqual(lists)
  })

  it('moves a row up only within the list it is stored in', () => {
    const lists = withSavedAction(scopedListsOf(YAML, undefined), deploy, 'machine', null)
    expect(withMovedUp(lists, 1)?.project).toEqual([board, release])
    expect(withMovedUp(lists, 2)).toBeNull()
  })
})
