import { z } from 'zod'
import {
  defaultGameMemberCapOf,
  GAME_HOST_CAP_MAX,
  type GameHostProfile
} from './orchestrator-game-lead'

/**
 * Where a connected host may take work: a saved environment named by its machine-local name, the
 * kind of work it runs, how many members at once, and which of its repos serves each ticket repo.
 */

export const HOST_PLACEMENT_ROLES = ['dev', 'e2e', 'any'] as const
export type HostPlacementRole = (typeof HOST_PLACEMENT_ROLES)[number]

const SELECTOR_MAX = 512
const capError = `must be a whole number from 1 to ${GAME_HOST_CAP_MAX}`
const selector = z.string().trim().min(1, 'must not be empty').max(SELECTOR_MAX)

// Strict: pairing codes and device tokens stay in orca-environments.json, never in a placement record.
const HostPlacementRecordSchema = z.strictObject(
  {
    environment: z
      .string({ error: 'must be a saved environment name' })
      .trim()
      .min(1, 'must not be empty'),
    role: z.enum(HOST_PLACEMENT_ROLES, {
      error: `must be one of ${HOST_PLACEMENT_ROLES.join(', ')}`
    }),
    cap: z
      .number({ error: capError })
      .int(capError)
      .min(1, capError)
      .max(GAME_HOST_CAP_MAX, capError)
      .optional(),
    repos: z.record(selector, selector).default({})
  },
  { error: 'a host placement record must be an object' }
)

export type HostPlacementRecord = z.infer<typeof HostPlacementRecordSchema>

export type HostPlacementRecordParse =
  | { ok: true; record: HostPlacementRecord }
  | { ok: false; error: string }

const issueText = (issue: z.core.$ZodIssue): string => {
  if (issue.code === 'unrecognized_keys') {
    return `not a placement field: ${issue.keys.join(', ')}; credentials stay in the environment store`
  }
  if (issue.code === 'invalid_key') {
    return 'repos must not map an empty ticket repo'
  }
  const at = issue.path.map(String).join('.')
  return at.length > 0 ? `${at} ${issue.message}` : issue.message
}

export function parseHostPlacementRecord(value: unknown): HostPlacementRecordParse {
  const result = HostPlacementRecordSchema.safeParse(value)
  return result.success
    ? { ok: true, record: result.data }
    : { ok: false, error: issueText(result.error.issues[0]) }
}

/** Members the host runs at once: its explicit cap, else what its memory and cores fit. */
export function hostPlacementCapOf(
  record: HostPlacementRecord,
  host: GameHostProfile | null
): number {
  return record.cap ?? defaultGameMemberCapOf(host)
}
