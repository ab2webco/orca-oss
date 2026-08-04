import { describe, expect, it } from 'vitest'
import { MAX_ENVELOPE_CORRECTION_ATTEMPTS, parseWorkerDoneEnvelope } from './worker-done-envelope'

const VALID = {
  status: 'success',
  summary: 'Added the envelope schema.',
  artifacts: [{ kind: 'pr', ref: 'https://github.com/org/repo/pull/1' }],
  verification: [
    {
      claim: 'runtime rejects a bad envelope',
      evidence: 'live send returned invalid_envelope',
      level: 'live'
    }
  ],
  outOfScopeWrites: [],
  notesForNextAgent: 'Federated correction rounds are one-way.'
}

describe('worker_done envelope schema', () => {
  it('accepts a complete envelope and fills the optional collections', () => {
    const parsed = parseWorkerDoneEnvelope({
      status: 'blocked',
      summary: 'Cannot reach the staging host.'
    })
    expect(parsed).toEqual({
      ok: true,
      envelope: {
        status: 'blocked',
        summary: 'Cannot reach the staging host.',
        artifacts: [],
        verification: [],
        outOfScopeWrites: [],
        notesForNextAgent: ''
      }
    })
  })

  it('accepts the full shape', () => {
    expect(parseWorkerDoneEnvelope(VALID).ok).toBe(true)
  })

  it('rejects a missing envelope', () => {
    const parsed = parseWorkerDoneEnvelope(undefined)
    expect(parsed).toMatchObject({ ok: false })
    expect(parsed.ok === false && parsed.errors[0]).toContain('envelope: missing')
  })

  it.each([
    ['banana', 'status'],
    ['', 'status']
  ])('rejects status %s', (status, field) => {
    const parsed = parseWorkerDoneEnvelope({ ...VALID, status })
    expect(parsed.ok).toBe(false)
    expect(parsed.ok === false && parsed.errors.join(' ')).toContain(field)
  })

  it('rejects an empty summary', () => {
    const parsed = parseWorkerDoneEnvelope({ ...VALID, summary: '   ' })
    expect(parsed.ok === false && parsed.errors).toContain('summary: summary must not be empty')
  })

  // Why: the ticket's core rule — a green report with an unverified claim is
  // exactly the failure this envelope exists to catch.
  it('rejects success carrying a level "none" claim', () => {
    const parsed = parseWorkerDoneEnvelope({
      ...VALID,
      verification: [{ claim: 'rollback works', evidence: '', level: 'none' }]
    })
    expect(parsed.ok === false && parsed.errors.join(' ')).toContain(
      'status "success" cannot carry a claim with level "none"'
    )
  })

  it('accepts a level "none" claim when the status is not success', () => {
    expect(
      parseWorkerDoneEnvelope({
        ...VALID,
        status: 'blocked',
        verification: [{ claim: 'rollback works', evidence: '', level: 'none' }]
      }).ok
    ).toBe(true)
  })

  it('rejects success with no verification at all', () => {
    const parsed = parseWorkerDoneEnvelope({ ...VALID, verification: [] })
    expect(parsed.ok === false && parsed.errors.join(' ')).toContain(
      'requires at least one verification claim'
    )
  })

  it('rejects a live or unit claim with no evidence', () => {
    const parsed = parseWorkerDoneEnvelope({
      ...VALID,
      verification: [{ claim: 'tests pass', evidence: '  ', level: 'unit' }]
    })
    expect(parsed.ok === false && parsed.errors.join(' ')).toContain('requires evidence')
  })

  it('rejects an unknown artifact kind', () => {
    const parsed = parseWorkerDoneEnvelope({
      ...VALID,
      artifacts: [{ kind: 'screenshot', ref: 'a.png' }]
    })
    expect(parsed.ok === false && parsed.errors.join(' ')).toContain('artifacts[0].kind')
  })

  // Why: a silently-dropped field reads to the coordinator as "nothing to
  // report", so a typo has to name the field it meant.
  it('rejects snake_case keys and names the camelCase field', () => {
    const parsed = parseWorkerDoneEnvelope({
      status: 'blocked',
      summary: 'Stopped early.',
      out_of_scope_writes: ['src/other.ts'],
      notes_for_next_agent: 'read the report'
    })
    expect(parsed.ok === false && parsed.errors.join(' ')).toContain(
      'out_of_scope_writes (use outOfScopeWrites)'
    )
    expect(parsed.ok === false && parsed.errors.join(' ')).toContain(
      'notes_for_next_agent (use notesForNextAgent)'
    )
  })

  it('caps in-session correction at two attempts', () => {
    expect(MAX_ENVELOPE_CORRECTION_ATTEMPTS).toBe(2)
  })
})
