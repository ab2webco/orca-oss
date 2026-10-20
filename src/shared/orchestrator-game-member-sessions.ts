/** What the lead needs to resume a member after Orca or the machine restarts: `orca game resume-members`. */

export const GAME_MEMBER_SESSIONS_VERSION = 1
// Why 50: a few times the 12-member cap, so finished members the lead never swept still fit.
export const GAME_MEMBER_SESSIONS_MAX = 50

export type GameMemberSession = {
  /** Upper-case ticket id; one entry per ticket in a project. */
  ticket: string
  name: string | null
  runId: string
  taskId: string
  dispatchId: string | null
  worktreeId: string | null
  branch: string | null
  agent: string | null
  /** The managed account the member runs on (Claude or Codex id); null for Orca's own selection. */
  accountId: string | null
  account: string | null
  /** The agent's own conversation id (Claude `session_id`), learned once the member is live. */
  sessionId: string | null
  lastState: string | null
  launchedAt: string
  updatedAt: string
}

export type GameMemberSessionPatch = { ticket: string } & Partial<
  Omit<GameMemberSession, 'ticket' | 'updatedAt'>
>

/** Keys a newer Orca added that this one does not know; a rewrite puts them back where they were. */
export type GameMemberSessionsKept = {
  file: Record<string, unknown>
  members: Record<string, Record<string, unknown>>
}

export type GameMemberSessionsRead =
  | { ok: true; members: GameMemberSession[]; kept?: GameMemberSessionsKept }
  | { ok: false; reason: string; newer?: true }

const TEXT_MAX = 200
const NULLABLE_FIELDS = [
  'name',
  'dispatchId',
  'worktreeId',
  'branch',
  'agent',
  'accountId',
  'account',
  'sessionId',
  'lastState'
] as const
const REQUIRED_FIELDS = ['ticket', 'runId', 'taskId', 'launchedAt', 'updatedAt'] as const

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const isText = (value: unknown): value is string =>
  typeof value === 'string' && value !== '' && value.length <= TEXT_MAX

function parseMember(raw: unknown): GameMemberSession | null {
  if (!isRecord(raw)) {
    return null
  }
  if (!REQUIRED_FIELDS.every((key) => isText(raw[key]))) {
    return null
  }
  if (!NULLABLE_FIELDS.every((key) => raw[key] === null || isText(raw[key]))) {
    return null
  }
  const member = Object.fromEntries(
    [...REQUIRED_FIELDS, ...NULLABLE_FIELDS].map((key) => [key, raw[key]])
  ) as GameMemberSession
  return { ...member, ticket: member.ticket.toUpperCase() }
}

const MEMBER_KEYS: ReadonlySet<string> = new Set([...REQUIRED_FIELDS, ...NULLABLE_FIELDS])
const FILE_KEYS: ReadonlySet<string> = new Set(['version', 'members'])

const keysOutside = (
  raw: Record<string, unknown>,
  known: ReadonlySet<string>
): Record<string, unknown> =>
  Object.fromEntries(Object.entries(raw).filter(([key]) => !known.has(key)))

/**
 * Strict on purpose: a file this Orca cannot read whole is reported, never read as empty, so the next
 * write cannot silently replace what an older or newer Orca saved.
 */
export function parseGameMemberSessionsFile(text: string): GameMemberSessionsRead {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return { ok: false, reason: 'the saved members file is damaged (not JSON)' }
  }
  if (!isRecord(parsed) || typeof parsed.version !== 'number') {
    return { ok: false, reason: 'the saved members file has no version' }
  }
  if (parsed.version > GAME_MEMBER_SESSIONS_VERSION) {
    return {
      ok: false,
      reason: `the saved members file is from a newer Orca (version ${parsed.version})`,
      newer: true
    }
  }
  if (parsed.version !== GAME_MEMBER_SESSIONS_VERSION || !Array.isArray(parsed.members)) {
    return { ok: false, reason: `the saved members file is damaged (version ${parsed.version})` }
  }
  const members: GameMemberSession[] = []
  const kept: GameMemberSessionsKept = { file: keysOutside(parsed, FILE_KEYS), members: {} }
  for (const [index, raw] of parsed.members.entries()) {
    const member = parseMember(raw)
    if (!member || !isRecord(raw)) {
      return {
        ok: false,
        reason: `the saved members file has a malformed member (entry ${index + 1})`
      }
    }
    members.push(member)
    const extra = keysOutside(raw, MEMBER_KEYS)
    if (Object.keys(extra).length > 0) {
      kept.members[member.ticket] = extra
    }
  }
  const keepsAny = Object.keys(kept.file).length > 0 || Object.keys(kept.members).length > 0
  return keepsAny ? { ok: true, members, kept } : { ok: true, members }
}

// Why the kept keys: an older Orca must not drop the optional fields a newer one added (game-data-migrations rule 1).
export function serializeGameMemberSessions(
  members: readonly GameMemberSession[],
  kept?: GameMemberSessionsKept
): string {
  return JSON.stringify({
    ...kept?.file,
    version: GAME_MEMBER_SESSIONS_VERSION,
    members: members.map((member) => ({ ...kept?.members[member.ticket], ...member }))
  })
}

// Why clip: the parser refuses a longer field, and a long display name must not make the file unreadable.
const clipped = (patch: GameMemberSessionPatch): GameMemberSessionPatch =>
  Object.fromEntries(
    Object.entries(patch).map(([key, value]) => [
      key,
      typeof value === 'string' ? value.slice(0, TEXT_MAX) : value
    ])
  ) as GameMemberSessionPatch

/** A member the project had live that is not live now: what `game fleet` and the lead show as paused. */
export type GamePausedMember = {
  ticket: string
  name: string | null
  agent: string | null
  account: string | null
  branch: string | null
  lastState: string | null
  /** Whether its own conversation can be resumed; without one it is relaunched in its worktree. */
  resumable: boolean
  since: string
}

/**
 * Every saved member not live now, except the ones that finished. Why the worktrees: a pane that
 * leads no one still sees the lead's members running there, and nothing resumes over a live agent.
 */
export function pausedMembersOf(
  members: readonly GameMemberSession[],
  live: { tickets: ReadonlySet<string>; worktreeIds: ReadonlySet<string> }
): GamePausedMember[] {
  return members
    .filter(
      (one) =>
        one.lastState !== 'finished' &&
        !live.tickets.has(one.ticket) &&
        !(one.worktreeId !== null && live.worktreeIds.has(one.worktreeId))
    )
    .map((one) => ({
      ticket: one.ticket,
      name: one.name,
      agent: one.agent,
      account: one.account,
      branch: one.branch,
      lastState: one.lastState,
      resumable: one.sessionId !== null && one.worktreeId !== null,
      since: one.updatedAt
    }))
}

/**
 * Upserts one member by ticket. Returns `members` itself when nothing changed, so a caller can skip
 * the write; a member it does not hold yet is only added with its task and run.
 */
export function mergeGameMemberSession(
  members: readonly GameMemberSession[],
  patch: GameMemberSessionPatch,
  now: string
): GameMemberSession[] {
  patch = clipped(patch)
  const ticket = patch.ticket.toUpperCase()
  const index = members.findIndex((one) => one.ticket === ticket)
  const current = members[index]
  if (!current) {
    if (!patch.taskId || !patch.runId) {
      return members as GameMemberSession[]
    }
    const added: GameMemberSession = {
      name: null,
      dispatchId: null,
      worktreeId: null,
      branch: null,
      agent: null,
      accountId: null,
      account: null,
      sessionId: null,
      lastState: null,
      launchedAt: now,
      ...patch,
      ticket,
      runId: patch.runId,
      taskId: patch.taskId,
      updatedAt: now
    }
    return [...members, added].slice(-GAME_MEMBER_SESSIONS_MAX)
  }
  // Why keep launchedAt: a relaunch on the same task is the same member's work.
  const { launchedAt: _launchedAt, ticket: _ticket, ...changes } = patch
  const changed = (Object.keys(changes) as (keyof typeof changes)[]).some(
    (key) => changes[key] !== undefined && changes[key] !== current[key]
  )
  if (!changed) {
    return members as GameMemberSession[]
  }
  const defined = Object.fromEntries(
    Object.entries(changes).filter((entry) => entry[1] !== undefined)
  )
  const next = members.slice()
  next[index] = { ...current, ...defined, updatedAt: now }
  return next
}
