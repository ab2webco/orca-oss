import { z } from 'zod'
import { OptionalFiniteNumber, OptionalString, requiredString } from '../schemas'

export const OptionalWorkerLaunchPreference = z
  .string()
  .min(1)
  .max(512)
  .refine((value) => value === value.trim(), 'Surrounding whitespace is invalid')
  .optional()

export const WorkerStartParams = z.object({
  task: requiredString('Missing --task'),
  on: OptionalString,
  run: OptionalString,
  from: requiredString('Missing --from'),
  worktree: OptionalString,
  name: OptionalString,
  repo: OptionalString,
  baseBranch: OptionalString,
  displayName: OptionalString,
  comment: OptionalString,
  setup: z.enum(['run', 'skip', 'inherit']).optional(),
  terminal: OptionalString,
  agent: OptionalString,
  claudeAccountId: OptionalString,
  codexAccountId: OptionalString,
  // Why a selector, not an id: with --on the host resolves `auto` or an email against its own roster (ORCA-798).
  remoteAccount: OptionalString,
  model: OptionalWorkerLaunchPreference,
  effort: OptionalWorkerLaunchPreference,
  retryOf: OptionalString,
  timeoutMs: OptionalFiniteNumber,
  devMode: z.boolean().optional(),
  // Why optional: only `orca game launch` sends it; an older runtime ignores it and starts plain.
  game: z.boolean().optional(),
  // Why optional: an older CLI omits it and starts at once, as before (ORCA-746).
  setupAdmission: z.enum(['queue']).optional()
})

export type WorkerStartInput = z.infer<typeof WorkerStartParams>
