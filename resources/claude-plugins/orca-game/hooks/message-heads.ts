import type { EngineInterface } from 'claude-code'

import type { ScenePhase } from '../types'

// Each session's headings by their block's text, so a resumed session redraws them with their time.

export type MessageHead = { phase: ScenePhase; time: string }

const HEADS_KEY = 'message-heads'
const SESSIONS_MAX = 20
const HEADS_MAX = 300
const PHASES: readonly ScenePhase[] = ['working', 'docs', 'build', 'verify', 'pr', 'handoff']

type Sessions = Record<string, Record<string, MessageHead>>

const isShape = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const headOf = (value: unknown): MessageHead | undefined => {
  if (!isShape(value) || typeof value.time !== 'string') {
    return undefined
  }
  const phase = PHASES.find((one) => one === value.phase)
  return phase === undefined ? undefined : { phase, time: value.time }
}

const headsOf = (value: unknown): Record<string, MessageHead> =>
  isShape(value)
    ? Object.fromEntries(
        Object.entries(value).flatMap(([key, one]) => {
          const head = headOf(one)
          return head === undefined ? [] : [[key, head] as const]
        })
      )
    : {}

const sessionsOf = (value: unknown): Sessions =>
  isShape(value)
    ? Object.fromEntries(Object.entries(value).map(([id, heads]) => [id, headsOf(heads)]))
    : {}

async function read($: EngineInterface): Promise<Sessions> {
  return sessionsOf(await $.store.get(HEADS_KEY).catch(() => undefined))
}

/** The heading this session drew for a block, in this process or before a resume. */
export async function storedHeadOf(
  $: EngineInterface,
  key: string
): Promise<MessageHead | undefined> {
  const session = await $.session.id()
  return (await read($))[session]?.[key]
}

// Why the oldest go first: the store lives across sessions and must not grow without end.
/** Keeps a block's heading for a later resume; only one with a time is worth keeping. */
export async function storeHead($: EngineInterface, key: string, head: MessageHead): Promise<void> {
  if (head.time === '') {
    return
  }
  const session = await $.session.id()
  const sessions = await read($)
  const heads = Object.entries({ ...sessions[session], [key]: head }).slice(-HEADS_MAX)
  delete sessions[session]
  const kept = Object.entries(sessions).slice(1 - SESSIONS_MAX)
  await $.store.set(HEADS_KEY, Object.fromEntries([...kept, [session, Object.fromEntries(heads)]]))
}
