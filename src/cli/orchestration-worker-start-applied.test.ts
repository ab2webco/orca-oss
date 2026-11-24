import { describe, expect, it, vi } from 'vitest'
import { RuntimeClientError, RuntimeRpcFailureError } from './runtime-client'
import {
  workerStartFailureOf,
  workerStartOutcomeProbe,
  type WorkerStartOutcomeProbe
} from './orchestration-worker-start-applied'

const REQ = 'req_1'

// Why this message: what the client throws when the runtime dropped the socket after the write.
const dropped = () =>
  new RuntimeClientError(
    'runtime_unavailable',
    `The Orca Lab runtime closed the connection before responding. Restart Orca Lab and try again. Orchestration mutation request ID: ${REQ}.`,
    { orchestrationRequestId: REQ }
  )

const failureOf = async (error: unknown, probe: WorkerStartOutcomeProbe) =>
  (await workerStartFailureOf(error, REQ, probe)) as RuntimeClientError

describe('worker-start says whether a start with a lost answer applied (ORCA-1398)', () => {
  it('applied: names the accepted Dispatch and gives no retry advice', async () => {
    const error = await failureOf(dropped(), async () => ({
      applied: 'applied',
      dispatchId: 'ctx_9'
    }))
    expect(error.code).toBe('runtime_unavailable')
    expect(error.message).toContain(
      'The start applied: Orca Lab accepted it as Dispatch ctx_9, so do not start another worker.'
    )
    expect(error.message).not.toContain('Restart Orca Lab and try again')
    expect(error.message).not.toContain('--retry-request')
    expect(error.data).toMatchObject({ applied: 'applied', dispatchId: 'ctx_9' })
  })

  it('not applied: the runtime holds no record of the request', async () => {
    const error = await failureOf(dropped(), async () => ({ applied: 'not_applied' }))
    expect(error.message).toContain(
      `The start did not apply: Orca Lab holds no record of request ${REQ}, so no worker started.`
    )
    expect(error.data).toMatchObject({ applied: 'not_applied', orchestrationRequestId: REQ })
  })

  it('not applied without asking: the connection failed before the request was written', async () => {
    const probe = vi.fn<WorkerStartOutcomeProbe>()
    const neverConnected = new RuntimeClientError(
      'runtime_unavailable',
      'Could not connect to the Orca Lab runtime transport from this shell.',
      { requestSent: false, orchestrationRequestId: REQ }
    )
    const error = await failureOf(neverConnected, probe)
    expect(error.data).toMatchObject({ applied: 'not_applied' })
    expect(probe).not.toHaveBeenCalled()
  })

  it('not applied without asking: the runtime metadata could not be read, so nothing was sent', async () => {
    const probe = vi.fn<WorkerStartOutcomeProbe>()
    const noMetadata = new RuntimeClientError('runtime_unavailable', 'Could not read metadata.')
    expect((await failureOf(noMetadata, probe)).data).toMatchObject({ applied: 'not_applied' })
    expect(probe).not.toHaveBeenCalled()
  })

  it('asks the runtime when it answered with an unknown-outcome code itself', async () => {
    const answered = new RuntimeRpcFailureError({
      id: 'rpc',
      ok: false,
      error: { code: 'remote_runtime_unavailable', message: 'm1 did not answer.' },
      _meta: { runtimeId: 'rt' }
    })
    const error = await failureOf(answered, async () => ({ applied: 'not_applied' }))
    expect(error.data).toMatchObject({ applied: 'not_applied' })
  })

  it('unknown: keeps the idempotent retry advice and says the outcome is unknown', async () => {
    const error = await failureOf(dropped(), async () => ({
      applied: 'unknown',
      reason: 'unanswered'
    }))
    expect(error.message).toContain(`--retry-request ${REQ}`)
    expect(error.message).toContain(
      'Whether the start applied is unknown: Orca Lab could not be asked.'
    )
    expect(error.data).toMatchObject({ applied: 'unknown', orchestrationRequestId: REQ })
  })

  it('unknown: words the line from what Orca Lab answered, not as unasked', async () => {
    const inFlight = await failureOf(dropped(), async () => ({
      applied: 'unknown',
      reason: 'in_flight'
    }))
    expect(inFlight.message).toContain(
      `Whether the start applied is unknown: Orca Lab is still handling request ${REQ}.`
    )
    expect(inFlight.message).not.toContain('could not be asked')
    const noDispatch = await failureOf(dropped(), async () => ({
      applied: 'unknown',
      reason: 'no_dispatch'
    }))
    expect(noDispatch.message).toContain(
      `Whether the start applied is unknown: Orca Lab recorded request ${REQ} but no Dispatch for it, as a start queued for setup does.`
    )
    expect(noDispatch.message).not.toContain('could not be asked')
  })

  it('a --retry-request start asks the runtime even when the connection never opened', async () => {
    // Why: the id may have applied on an earlier attempt, so a refused connection proves nothing.
    const probe = vi.fn<WorkerStartOutcomeProbe>(async () => ({
      applied: 'unknown',
      reason: 'unanswered'
    }))
    const neverConnected = new RuntimeClientError(
      'runtime_unavailable',
      'Could not connect to the Orca Lab runtime transport from this shell.',
      { requestSent: false, orchestrationRequestId: REQ }
    )
    const error = (await workerStartFailureOf(
      neverConnected,
      REQ,
      probe,
      true
    )) as RuntimeClientError
    expect(probe).toHaveBeenCalledWith(REQ)
    expect(error.data).toMatchObject({ applied: 'unknown' })
    expect(error.message).not.toContain('did not apply')
  })

  it('leaves an answer that is not an unknown outcome untouched', async () => {
    const refused = new RuntimeClientError('task_not_startable', 'Task is done.')
    expect(await workerStartFailureOf(refused, REQ, vi.fn())).toBe(refused)
  })

  it('probe: an older runtime without the lookup, or a silent one, is unknown', async () => {
    const call = vi.fn().mockRejectedValue(new RuntimeClientError('method_not_found', 'Unknown'))
    const probe = workerStartOutcomeProbe({ call } as never)
    await expect(probe(REQ)).resolves.toEqual({ applied: 'unknown', reason: 'unanswered' })
    expect(call).toHaveBeenCalledWith(
      'orchestration.workerStartOutcome',
      { requestId: REQ },
      expect.objectContaining({ timeoutMs: expect.any(Number) })
    )
  })

  it('probe: reads applied with its Dispatch, and not applied', async () => {
    const reply = (result: unknown) =>
      workerStartOutcomeProbe({ call: vi.fn().mockResolvedValue({ result }) } as never)(REQ)
    await expect(reply({ applied: 'applied', dispatchId: 'ctx_9' })).resolves.toEqual({
      applied: 'applied',
      dispatchId: 'ctx_9'
    })
    await expect(reply({ applied: 'not_applied' })).resolves.toEqual({ applied: 'not_applied' })
    await expect(reply({ applied: 'applied' })).resolves.toEqual({
      applied: 'unknown',
      reason: 'undecided'
    })
    await expect(reply({ applied: 'unknown', reason: 'in_flight' })).resolves.toEqual({
      applied: 'unknown',
      reason: 'in_flight'
    })
    await expect(reply({ applied: 'unknown', reason: 'no_dispatch' })).resolves.toEqual({
      applied: 'unknown',
      reason: 'no_dispatch'
    })
  })
})
