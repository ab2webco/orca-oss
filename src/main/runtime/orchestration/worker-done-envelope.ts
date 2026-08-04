import { z } from 'zod'
import type { WorkerReportOutcome } from './types'

export const WORKER_ENVELOPE_STATUSES = ['success', 'blocked', 'failed'] as const
export const WORKER_ENVELOPE_ARTIFACT_KINDS = ['pr', 'commit', 'file', 'report'] as const
export const WORKER_ENVELOPE_VERIFICATION_LEVELS = ['live', 'unit', 'none'] as const

// Why: measured on ORCA-178 — re-briefing a derailed worker in its own session
// did not recover it, so the in-session loop is capped and the coordinator
// starts a fresh session instead of re-prompting a session with bad context.
export const MAX_ENVELOPE_CORRECTION_ATTEMPTS = 2

function nonEmptyText(field: string): z.ZodString {
  return z.string().trim().min(1, `${field} must not be empty`)
}

// Why: the correction loop is only useful if the message names the allowed
// values; Zod's default "Invalid input" costs the worker a whole round.
function expected(field: string, values: readonly string[]): string {
  return `${field} must be one of ${values.join('|')}`
}

const ArtifactSchema = z.strictObject({
  kind: z.enum(WORKER_ENVELOPE_ARTIFACT_KINDS, {
    error: expected('kind', WORKER_ENVELOPE_ARTIFACT_KINDS)
  }),
  ref: nonEmptyText('ref')
})

const VerificationSchema = z
  .strictObject({
    claim: nonEmptyText('claim'),
    evidence: z.string({ error: 'evidence must be a string' }).trim(),
    level: z.enum(WORKER_ENVELOPE_VERIFICATION_LEVELS, {
      error: expected('level', WORKER_ENVELOPE_VERIFICATION_LEVELS)
    })
  })
  .superRefine((entry, ctx) => {
    if (entry.level !== 'none' && entry.evidence.length === 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['evidence'],
        message: `level "${entry.level}" requires evidence; use level "none" when the claim was not verified`
      })
    }
  })

export const WorkerDoneEnvelopeSchema = z
  .strictObject({
    status: z.enum(WORKER_ENVELOPE_STATUSES, {
      error: expected('status', WORKER_ENVELOPE_STATUSES)
    }),
    summary: nonEmptyText('summary'),
    artifacts: z
      .array(ArtifactSchema, { error: 'artifacts must be an array of { kind, ref }' })
      .default([]),
    verification: z
      .array(VerificationSchema, {
        error: 'verification must be an array of { claim, evidence, level }'
      })
      .default([]),
    outOfScopeWrites: z
      .array(nonEmptyText('outOfScopeWrites entry'), {
        error: 'outOfScopeWrites must be an array of paths'
      })
      .default([]),
    notesForNextAgent: z.string({ error: 'notesForNextAgent must be a string' }).default('')
  })
  .superRefine((envelope, ctx) => {
    if (envelope.status !== 'success') {
      return
    }
    if (envelope.verification.length === 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['verification'],
        message: 'status "success" requires at least one verification claim'
      })
      return
    }
    // Why: the whole point of `level` — a success that carries an unverified
    // claim is the prose summary this ticket exists to kill.
    envelope.verification.forEach((entry, index) => {
      if (entry.level === 'none') {
        ctx.addIssue({
          code: 'custom',
          path: ['verification', index, 'level'],
          message:
            'status "success" cannot carry a claim with level "none"; give live or unit evidence, drop the claim, or report status "blocked"'
        })
      }
    })
  })

export type WorkerDoneEnvelope = z.infer<typeof WorkerDoneEnvelopeSchema>

export type WorkerDoneEnvelopeParseResult =
  | { ok: true; envelope: WorkerDoneEnvelope }
  | { ok: false; errors: string[] }

const ENVELOPE_KEYS = [
  'status',
  'summary',
  'artifacts',
  'verification',
  'outOfScopeWrites',
  'notesForNextAgent'
]

function toCamelCase(key: string): string {
  return key.replace(/_([a-z])/g, (_match, letter: string) => letter.toUpperCase())
}

function formatIssuePath(path: readonly PropertyKey[]): string {
  if (path.length === 0) {
    return 'envelope'
  }
  return path.reduce<string>((acc, segment) => {
    if (typeof segment === 'number') {
      return `${acc}[${segment}]`
    }
    return acc.length === 0 ? String(segment) : `${acc}.${String(segment)}`
  }, '')
}

function describeUnrecognizedKeys(keys: readonly string[], path: readonly PropertyKey[]): string {
  const described = keys.map((key) => {
    const camel = toCamelCase(key)
    // Why: the ticket text spells these snake_case; name the camelCase field
    // so the correction round is one edit rather than a guess.
    return camel !== key && ENVELOPE_KEYS.includes(camel) ? `${key} (use ${camel})` : key
  })
  return `${formatIssuePath(path)}: unknown field(s) ${described.join(', ')}`
}

function formatIssues(issues: readonly z.core.$ZodIssue[]): string[] {
  return issues.map((issue) => {
    if (issue.code === 'unrecognized_keys') {
      return describeUnrecognizedKeys(issue.keys, issue.path)
    }
    return `${formatIssuePath(issue.path)}: ${issue.message}`
  })
}

export function parseWorkerDoneEnvelope(value: unknown): WorkerDoneEnvelopeParseResult {
  if (value === undefined || value === null) {
    return {
      ok: false,
      errors: [
        'envelope: missing. worker_done requires a typed envelope (status, summary, artifacts, verification, outOfScopeWrites, notesForNextAgent).'
      ]
    }
  }
  const result = WorkerDoneEnvelopeSchema.safeParse(value)
  if (result.success) {
    return { ok: true, envelope: result.data }
  }
  return { ok: false, errors: formatIssues(result.error.issues) }
}

export function envelopeStatusOutcome(status: WorkerDoneEnvelope['status']): WorkerReportOutcome {
  return status === 'success' ? 'succeeded' : 'failed'
}

export function buildEnvelopeCorrectionReason(errors: string[], attempt: number): string {
  const remaining = MAX_ENVELOPE_CORRECTION_ATTEMPTS - attempt
  return (
    `worker_done envelope rejected (correction ${attempt} of ${MAX_ENVELOPE_CORRECTION_ATTEMPTS}, ` +
    `${remaining} left): ${errors.join('; ')}. ` +
    'Resend the same worker_done with a corrected --envelope-file.'
  )
}

export function buildEnvelopeExhaustedReason(errors: string[]): string {
  return (
    `worker_done envelope still invalid after ${MAX_ENVELOPE_CORRECTION_ATTEMPTS} corrections; ` +
    'this session will not be asked again. The coordinator must start a fresh worker session with ' +
    `this failure appended to the brief. Last errors: ${errors.join('; ')}.`
  )
}
