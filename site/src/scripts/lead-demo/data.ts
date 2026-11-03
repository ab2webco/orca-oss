// Invented demo data for the hero: a lead's Panel on example.com tickets (ACME-xxx).
// Nothing here is real; the sequence mirrors what the Orca Game Panel shows.

export type Source = 'jira' | 'plane' | 'linear' | 'github'
export type MemberState = 'working' | 'question' | 'done'
export type Ci = 'none' | 'running' | 'green'
export type Phone = 'hidden' | 'asking' | 'answered'

export type Ticket = {
  id: string
  source: Source
}

export type Member = {
  ticket: Ticket
  host: string
  branch: string
  pr: number | null
  ci: Ci
  state: MemberState
  merged: boolean
}

export type LogEntry = {
  key: LogKey
  ticket: string
  xp: number
}

export type LogKey = 'claimed' | 'ciGreen' | 'merged' | 'done' | 'asked' | 'answered'

export type Frame = {
  todo: Ticket[]
  members: Member[]
  xp: number
  level: number
  log: LogEntry[]
  phone: Phone
  prompt: 'idle' | 'wave'
  levelUp: boolean
}

const T = {
  a204: { id: 'ACME-204', source: 'jira' },
  a206: { id: 'ACME-206', source: 'linear' },
  a212: { id: 'ACME-212', source: 'plane' },
  g482: { id: '#482', source: 'github' },
  a219: { id: 'ACME-219', source: 'jira' },
  a221: { id: 'ACME-221', source: 'plane' }
} satisfies Record<string, Ticket>

export const LEVEL_XP = [0, 200, 450, 700, 1000, 1200, 1500, 2000]

const member = (ticket: Ticket, host: string, branch: string, extra: Partial<Member>): Member => ({
  ticket,
  host,
  branch,
  pr: null,
  ci: 'none',
  state: 'working',
  merged: false,
  ...extra
})

export const initialFrame: Frame = {
  todo: [T.a212, T.g482, T.a219, T.a221],
  members: [
    member(T.a204, 'build-box', 'acme-204-card-retry', { pr: 318, ci: 'running' }),
    member(T.a206, 'old-imac', 'acme-206-search-limits', { pr: 321, ci: 'running' })
  ],
  xp: 1350,
  level: levelFor(1350),
  log: [
    { key: 'claimed', ticket: 'ACME-206', xp: 10 },
    { key: 'merged', ticket: 'ACME-198', xp: 100 },
    { key: 'ciGreen', ticket: 'ACME-198', xp: 20 }
  ],
  phone: 'hidden',
  prompt: 'idle',
  levelUp: false
}

type Step = { delay: number; apply: (frame: Frame) => Frame }

const withLog = (frame: Frame, entry: LogEntry): Frame => ({
  ...frame,
  xp: frame.xp + entry.xp,
  log: [entry, ...frame.log].slice(0, 4)
})

const updateMember = (frame: Frame, id: string, patch: Partial<Member>): Frame => ({
  ...frame,
  members: frame.members.map((m) => (m.ticket.id === id ? { ...m, ...patch } : m))
})

function levelFor(xp: number): number {
  let level = 0
  LEVEL_XP.forEach((threshold, index) => {
    if (xp >= threshold) {
      level = index
    }
  })
  return level
}

export function xpProgress(frame: Frame): number {
  const floor = LEVEL_XP[frame.level] ?? 0
  const ceil = LEVEL_XP[frame.level + 1] ?? floor + 500
  return Math.max(0, Math.min(1, (frame.xp - floor) / (ceil - floor)))
}

const settleLevel = (frame: Frame): Frame => {
  const level = levelFor(frame.xp)
  return { ...frame, level, levelUp: level > frame.level }
}

// One loop of the hero, about 15 seconds.
export const timeline: Step[] = [
  { delay: 1400, apply: (f) => ({ ...f, prompt: 'wave' }) },
  {
    delay: 1100,
    apply: (f) => {
      const launched = [
        member(T.a212, 'local', 'acme-212-invoice-dark', {}),
        member(T.g482, 'local', 'gh-482-safari-login', {})
      ]
      const next = {
        ...f,
        prompt: 'idle' as const,
        todo: f.todo.slice(2),
        members: [...f.members, ...launched]
      }
      return withLog(withLog(next, { key: 'claimed', ticket: 'ACME-212', xp: 10 }), {
        key: 'claimed',
        ticket: '#482',
        xp: 10
      })
    }
  },
  {
    delay: 1900,
    apply: (f) =>
      withLog(updateMember(f, 'ACME-204', { ci: 'green' }), {
        key: 'ciGreen',
        ticket: 'ACME-204',
        xp: 20
      })
  },
  {
    delay: 1900,
    apply: (f) => {
      const merged = updateMember(f, 'ACME-204', { merged: true, state: 'done' })
      const paid = withLog(withLog(merged, { key: 'merged', ticket: 'ACME-204', xp: 100 }), {
        key: 'done',
        ticket: 'ACME-204',
        xp: 70
      })
      return settleLevel(paid)
    }
  },
  {
    delay: 2200,
    apply: (f) =>
      withLog(
        { ...updateMember(f, 'ACME-206', { state: 'question' }), phone: 'asking', levelUp: false },
        { key: 'asked', ticket: 'ACME-206', xp: 0 }
      )
  },
  {
    delay: 2600,
    apply: (f) =>
      withLog(
        { ...updateMember(f, 'ACME-206', { state: 'working', ci: 'green' }), phone: 'answered' },
        { key: 'answered', ticket: 'ACME-206', xp: 0 }
      )
  },
  { delay: 3200, apply: () => initialFrame }
]

/** The still frame shown before scripts run and to people who prefer reduced motion. */
export function showcaseFrame(): Frame {
  let frame = initialFrame
  for (const step of timeline.slice(0, 5)) {
    frame = step.apply(frame)
  }
  return { ...frame, levelUp: false }
}
