// POC lives rules for ORCA-692, written for ORCA-686 to adopt or reject.
export const LIVES_START = 3
export const LIVES_MAX = 5

export type LifeEventKind = 'merged' | 'ci-green' | 'ci-red' | 'reverted'

/** `id` is stable per observed change (review + transition), so a replayed poll never re-counts. */
export type LifeEvent = { id: string; member: string; kind: LifeEventKind }

type CiSeen = 'green' | 'red' | 'unknown'

type MemberRecord = { lives: number; ci: CiSeen; seen: readonly string[] }

export type LivesBook = Readonly<Record<string, MemberRecord>>

export type LifeChange = { book: LivesBook; delta: -1 | 0 | 1 }

// Why bounded: the book lives as long as the band; ids only need to outlast a poll replay.
const SEEN_LIMIT = 64

const recordOf = (book: LivesBook, member: string): MemberRecord =>
  book[member] ?? { lives: LIVES_START, ci: 'unknown', seen: [] }

export const livesOf = (book: LivesBook, member: string): { lives: number; benched: boolean } => {
  const { lives } = recordOf(book, member)
  return { lives, benched: lives === 0 }
}

const deltaOf = (record: MemberRecord, kind: LifeEventKind): -1 | 0 | 1 => {
  switch (kind) {
    case 'merged':
      return record.ci === 'green' ? 1 : 0
    case 'ci-red':
      return record.ci === 'red' ? 0 : -1
    case 'reverted':
      return -1
    case 'ci-green':
      return 0
  }
}

const ciAfter = (record: MemberRecord, kind: LifeEventKind): CiSeen => {
  if (kind === 'ci-green') {
    return 'green'
  }
  if (kind === 'ci-red') {
    return 'red'
  }
  // Why: the next PR starts with unknown CI, so a second merge needs its own green.
  return kind === 'merged' ? 'unknown' : record.ci
}

export const applyLifeEvent = (book: LivesBook, event: LifeEvent): LifeChange => {
  const record = recordOf(book, event.member)
  if (record.seen.includes(event.id)) {
    return { book, delta: 0 }
  }
  const wanted = deltaOf(record, event.kind)
  const lives = Math.min(LIVES_MAX, Math.max(0, record.lives + wanted))
  const delta = (lives - record.lives) as -1 | 0 | 1
  const next: MemberRecord = {
    lives,
    ci: ciAfter(record, event.kind),
    seen: [...record.seen, event.id].slice(-SEEN_LIMIT)
  }
  return { book: { ...book, [event.member]: next }, delta }
}
