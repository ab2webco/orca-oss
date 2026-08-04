// Test-only sample envelopes shared by the orchestration suites, so a schema
// change lands in one place instead of every worker_done payload literal.
export const SUCCESS_ENVELOPE = {
  status: 'success',
  summary: 'Did the requested work.',
  verification: [{ claim: 'suite passes', evidence: 'npm test: 0 failures', level: 'unit' }]
}

export const FAILED_ENVELOPE = {
  status: 'failed',
  summary: 'The required service is unavailable.'
}
