import { describe, expect, it } from 'vitest'
import { isOrcaDispatchStatusPrompt } from './orca-dispatch-status-prompt'

const LAB = 'You are working inside Orca Lab, a multi-agent IDE. You are a dispatched worker.'
const UPSTREAM = 'You are working inside Orca, a multi-agent IDE. You are a dispatched worker.'

describe('isOrcaDispatchStatusPrompt', () => {
  // Why: the Lab brand renamed the preamble (ORCA-392) and its briefs stopped reading as briefs.
  it('knows the Lab preamble and the one an older host still sends', () => {
    expect(isOrcaDispatchStatusPrompt(LAB)).toBe(true)
    expect(isOrcaDispatchStatusPrompt(UPSTREAM)).toBe(true)
  })

  it('knows a brief wrapped in the pasted-content tag a pasted prompt carries', () => {
    expect(isOrcaDispatchStatusPrompt(`<pasted_content id="e1f9"> ${LAB}`)).toBe(true)
  })

  it('leaves a person’s own prompt alone', () => {
    expect(isOrcaDispatchStatusPrompt('Fix the checks tooltip')).toBe(false)
    expect(isOrcaDispatchStatusPrompt('<pasted_content id="1"> Fix the checks tooltip')).toBe(false)
  })
})
