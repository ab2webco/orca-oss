import type { GameAgent, GameMemberAccount, GameMemberLimit, GameMemberRemote } from '../types'
import { cellWidthOf } from './cell-width'
import { isEnvironmentId } from './game-config'
import { gameLocale, gameStrings, type GameLocale } from './game-strings'
import { remoteGoneTagOf } from './remote-member-view'

// What a member card says about the account its agent runs on.

const isShape = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

export const memberLimitOf = (value: unknown): GameMemberLimit | undefined => {
  if (!isShape(value)) {
    return undefined
  }
  const resetsAt = value.resetsAt
  if (resetsAt !== null && (typeof resetsAt !== 'number' || !Number.isFinite(resetsAt))) {
    return undefined
  }
  return value.loggedOut === true ? { resetsAt, loggedOut: true } : { resetsAt }
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

// Why not in the catalogs: game-strings.ts is at its line budget, and only this tag says it.
const LOGGED_OUT: Readonly<Record<GameLocale, string>> = {
  en: 'logged out · /login in its pane',
  es: 'sesión cerrada · /login en su panel'
}

export const limitTagOf = (limit: GameMemberLimit, now: number): string =>
  limit.loggedOut
    ? LOGGED_OUT[gameLocale()]
    : gameStrings().text.limited(backInOf(limit.resetsAt, now))

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
    ? {
        host: value.host,
        ...(isEnvironmentId(value.environmentId) ? { environmentId: value.environmentId } : {}),
        stateKnown: value.stateKnown !== false,
        ...(value.gone === true ? { gone: true as const } : {})
      }
    : undefined

/** `codex · ana@…`: the domain never shows, and the name shortens before the account is dropped. */
export const agentTagOf = (
  agent: {
    agentType: GameAgent['agentType']
    state?: GameAgent['state']
    account?: GameMemberAccount
    remote?: GameMemberRemote
  },
  room: number
): string => {
  const { remote } = agent
  // Why: `gone` means the host answered, even from an older Orca that also sent `stateKnown: false`.
  const answering = remote ? remote.stateKnown || remote.gone === true : false
  // Why `host ?`: a narrow card would ellipsize `imac not answering` into `imac no…`.
  const hosts = remote
    ? remote.gone && agent.state !== 'done'
      ? [remoteGoneTagOf(remote.host), `${remote.host} ✕`]
      : [
          gameStrings().text.remoteHost(remote.host, answering),
          answering ? remote.host : `${remote.host} ?`
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
