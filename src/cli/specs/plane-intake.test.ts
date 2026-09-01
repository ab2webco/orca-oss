import { describe, expect, it } from 'vitest'
import { PLANE_INTAKE_COMMAND_SPECS } from './plane-intake'

describe('Plane intake command specs', () => {
  it('keeps board-only fields off intake create', () => {
    const create = PLANE_INTAKE_COMMAND_SPECS.find(
      (spec) => spec.path.join(' ') === 'plane intake create'
    )

    expect(create?.allowedFlags).toContain('priority')
    expect(create?.allowedFlags).not.toContain('state')
    expect(create?.allowedFlags).not.toContain('parent')
    expect(create?.allowedFlags).not.toContain('label')
    expect(create?.allowedFlags).not.toContain('assignee')
  })
})
