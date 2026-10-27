import type { GameAgent, GameMemberAccount, GameMemberLimit, GameMemberRemote } from '../types'
import { cellWidthOf } from './cell-width'
import { gameStrings } from './game-strings'

// What a member card says about the account its agent runs on.

const isShape = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

export const memberLimitOf = (value: unknown): GameMemberLimit | undefined => {
  if (!isShape(value)) {
    return undefined
  }
  const resetsAt = value.resetsAt
  if (resetsAt === null) {
    return { resetsAt: null }
  }
  return typeof resetsAt === 'number' && Number.isFinite(resetsAt) ? { resetsAt } : undefined
}

/** "1h 30m" until `resetsAt`, rounded up to the minute; null when unknown or past. */
export const backInOf = (resetsAt: number | null, now: number): string | null => {
  if (resetsAt === null) {
    return null
  }
  const minutes = Math.ceil((resetsAt - now) / 60_000)
  if (minutes <= 0) {
    return null
  }
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  return [hours > 0 ? `${hours}h` : '', rest > 0 ? `${rest}m` : ''].filter(Boolean).join(' ')
}

export const limitTagOf = (limit: GameMemberLimit, now: number): string =>
  gameStrings().text.limited(backInOf(limit.resetsAt, now))

const PROVIDERS = ['claude', 'codex'] as const

export const memberAccountOf = (value: unknown): GameMemberAccount | undefined => {
  if (!isShape(value)) {
    return undefined
  }
  const provider = PROVIDERS.find((one) => one === value.provider)
  const { id, email } = value
  return provider && typeof id === 'string' && typeof email === 'string' && email.includes('@')
    ? { provider, id, email }
    : undefined
}

const SHORT_LOCAL = 3

export const memberRemoteOf = (value: unknown): GameMemberRemote | undefined =>
  isShape(value) && typeof value.host === 'string' && value.host !== ''
    ? { host: value.host, stateKnown: value.stateKnown !== false }
    : undefined

/** `codex · ana@…`: the domain never shows, and the name shortens before the account is dropped. */
export const agentTagOf = (
  agent: {
    agentType: GameAgent['agentType']
    account?: GameMemberAccount
    remote?: GameMemberRemote
  },
  room: number
): string => {
  const { remote } = agent
  // Why `host ?`: a narrow card would ellipsize `imac not answering` into `imac no…`.
  const hosts = remote
    ? [
        gameStrings().text.remoteHost(remote.host, remote.stateKnown),
        remote.stateKnown ? remote.host : `${remote.host} ?`
      ]
    : ['']
  const bases = [
    ...hosts.map((host) => [agent.agentType, host].filter(Boolean).join(' · ')),
    hosts.at(-1) || agent.agentType
  ]
  const base = bases[0]!
  const local = agent.account?.email.split('@')[0] ?? ''
  const tags = local
    ? [
        `${base} · ${local}@…`,
        `${base} · ${local.slice(0, SHORT_LOCAL)}${local.length > SHORT_LOCAL ? '…' : ''}@…`
      ]
    : []
  return [...tags, ...bases].find((tag) => cellWidthOf(tag) <= room) ?? bases.at(-1)!
}
