import { describe, expect, it } from 'vitest'
import { PLANE_PROJECT_COMMAND_SPECS } from './plane-project'
import { PLANE_COMMAND_SPECS } from './plane'
import type { CommandSpec } from '../args'

function spec(specs: CommandSpec[], path: string[]): CommandSpec {
  const found = specs.find((entry) => entry.path.join(' ') === path.join(' '))
  if (!found) {
    throw new Error(`No spec for ${path.join(' ')}`)
  }
  return found
}

// ORCA-140: the shipped help promised archived projects leave `project list`
// while they were still listed. The help is the contract an agent reads, so
// both halves of it are pinned here.
describe('plane project help text on archived projects', () => {
  it('tells archive callers that only --archived brings them back', () => {
    const notes = spec(PLANE_PROJECT_COMMAND_SPECS, ['plane', 'project', 'archive']).notes ?? []

    expect(notes.join('\n')).toContain('unless you pass --archived')
    expect(notes).not.toContain(
      'Archived projects drop out of project list, so record the project id before archiving — unarchive needs it.'
    )
  })

  it('points unarchive at the flag that finds the id again', () => {
    const notes = spec(PLANE_PROJECT_COMMAND_SPECS, ['plane', 'project', 'unarchive']).notes ?? []

    expect(notes.join('\n')).toContain('orca plane project list --archived')
    expect(notes.join('\n')).not.toContain('project list does not show archived projects')
  })

  it('advertises --archived on project list and accepts the flag', () => {
    const listSpec = spec(PLANE_COMMAND_SPECS, ['plane', 'project', 'list'])

    expect(listSpec.allowedFlags).toContain('archived')
    expect(listSpec.usage).toContain('[--archived]')
    expect((listSpec.notes ?? []).join('\n')).toContain('Archived projects are hidden by default')
  })
})
