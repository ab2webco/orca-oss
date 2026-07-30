import { describe, expect, it, vi } from 'vitest'
import { formatCliError, reportCliError } from '../format'
import { classifyRuntimeConnectionError } from './transport'
import { localAttachRecoveryData } from './local-attach-recovery'
import { RuntimeClientError } from './types'

// Why (ORCA-138): a data command that cannot attach to the local runtime must
// name the --pairing-code/--environment path. It previously ended at "Orca is not
// running. Run 'orca open' first." — false in the report (Orca was running) and a
// dead end, so the reporter went looking for raw REST API keys instead.

function attachError(): RuntimeClientError {
  return new RuntimeClientError(
    'runtime_unavailable',
    'Could not connect to the Orca runtime transport from this shell.',
    localAttachRecoveryData()
  )
}

describe('local attach recovery guidance', () => {
  it('instructs the pairing path on the human stderr output', () => {
    const output = formatCliError(attachError())

    expect(output).toContain('--pairing-code')
    expect(output).toContain('--environment')
    expect(output).toContain('orca environment add')
    // Why: the old dead-end string asserted something that was false in the report.
    expect(output).not.toContain('Orca is not running. Run')
  })

  it('instructs the pairing path in --json output', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    try {
      reportCliError(attachError(), true)

      const payload = JSON.parse(log.mock.calls[0]?.[0] as string) as {
        ok: boolean
        error: { code: string; data?: { nextSteps?: string[] } }
      }
      expect(payload.ok).toBe(false)
      expect(payload.error.code).toBe('runtime_unavailable')
      const nextSteps = payload.error.data?.nextSteps ?? []
      expect(nextSteps.join('\n')).toContain('--environment')
      expect(nextSteps.join('\n')).toContain('--pairing-code')
    } finally {
      log.mockRestore()
    }
  })

  it('classifies a refused local connection as a recoverable attach failure', () => {
    const error = classifyRuntimeConnectionError(
      Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' })
    )

    expect(error.code).toBe('runtime_unavailable')
    expect(formatCliError(error)).toContain('--environment')
  })

  it('keeps EACCES classified as access denied, not an attach failure', () => {
    const error = classifyRuntimeConnectionError(
      Object.assign(new Error('permission denied'), { code: 'EACCES' })
    )

    expect(error.code).toBe('runtime_access_denied')
    expect(formatCliError(error)).not.toContain('--pairing-code')
  })

  // Why: pairing advice on a mid-flight retry is noise — the connection worked.
  it('leaves retry-oriented runtime errors without pairing guidance', () => {
    const output = formatCliError(
      new RuntimeClientError(
        'runtime_unavailable',
        'The Orca runtime changed while the request was in flight. Retry the command.'
      )
    )

    expect(output).not.toContain('--pairing-code')
    expect(output).toContain("Orca is not running. Run 'orca open' first.")
  })
})
