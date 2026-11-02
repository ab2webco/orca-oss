import { describe, expect, it } from 'vitest'
import { createFailureEvidenceLog, redactFailureEvidence } from './failure-evidence-log'

describe('redactFailureEvidence', () => {
  it('replaces every home directory with a placeholder', () => {
    const redacted = redactFailureEvidence(
      'cwd=/home/runner/work and /tmp/orca-e2e-userdata-x/home/.codex',
      ['/home/runner', '/tmp/orca-e2e-userdata-x/home']
    )

    expect(redacted).toBe('cwd=~/work and ~/.codex')
  })

  it('redacts token, secret and key values in assignments, JSON and bearer headers', () => {
    const redacted = redactFailureEvidence(
      'authToken: "abc123" pairing token=zz9 {"clientSecret":"s3cr3t"} apiKey=k1 Authorization: Bearer eyJhbGc',
      []
    )

    expect(redacted).not.toMatch(/abc123|zz9|s3cr3t|k1\b|eyJhbGc/)
    expect(redacted).toContain('authToken: "<redacted>"')
    expect(redacted).toContain('Bearer <redacted>')
  })

  it('redacts a token carried in a URL query or fragment', () => {
    const redacted = redactFailureEvidence(
      'offer orca://pair?host=127.0.0.1&token=QWERTY#key=ASDF',
      []
    )

    expect(redacted).toBe('offer orca://pair?host=127.0.0.1&token=<redacted>#key=<redacted>')
  })
})

describe('createFailureEvidenceLog', () => {
  it('renders each source as its own redacted, timestamped section', () => {
    let now = 1_000
    const log = createFailureEvidenceLog({ homeDirs: ['/home/runner'], now: () => now })

    log.append('host-1', 'started in /home/runner/x\nsecond line')
    now = 2_500
    log.append('client-console', 'warning token=abc')

    expect(log.render()).toBe(
      [
        '## host-1',
        '[+0ms] started in ~/x',
        '[+0ms] second line',
        '',
        '## client-console',
        '[+1500ms] warning token=<redacted>',
        ''
      ].join('\n')
    )
  })

  it('keeps only the newest lines of a source past its cap and says how many it dropped', () => {
    const log = createFailureEvidenceLog({ homeDirs: [], maxLinesPerSource: 2, now: () => 0 })

    log.append('host-1', 'a\nb\nc\nd')

    expect(log.render()).toBe(
      ['## host-1', '[2 earlier lines dropped]', '[+0ms] c', '[+0ms] d', ''].join('\n')
    )
  })

  it('renders nothing when no source wrote anything', () => {
    const log = createFailureEvidenceLog({ homeDirs: [] })

    log.append('host-1', '\n')

    expect(log.render()).toBe('')
  })
})
