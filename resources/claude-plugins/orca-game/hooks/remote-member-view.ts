import type { GameAgent, GameLocale } from '../types'
import { gameLocale, gameStrings } from './game-strings'
import { NAMED_TICKET } from './member-character'

type RemoteText = {
  goneTag: (host: string) => string
  asleepTags: (host: string) => [string, string]
  resume: string
  reconnect: string
  waking: (name: string, host: string) => string
  woke: (name: string, host: string) => string
  notResumed: (name: string, reason: string) => string
  noAnswer: string
  reconnecting: (host: string) => string
  gone: (name: string, host: string) => string
  finished: (name: string, host: string) => string
  silent: (name: string, host: string, read: string) => string
  live: (name: string, host: string, read: string) => string
}

// Why apart from the catalog: a remote member's terminal lives on its host, and View says so (ORCA-790).
const REMOTE_TEXT: Record<GameLocale, RemoteText> = {
  en: {
    goneTag: (host) => `gone from ${host}`,
    asleepTags: (host) => [`asleep on ${host}`, `${host} asleep`],
    resume: 'Resume',
    reconnect: 'Reconnect',
    waking: (name, host) => `Waking ${name} on ${host}…`,
    woke: (name, host) => `${name} woke on ${host}`,
    notResumed: (name, reason) => `Could not resume ${name}: ${reason}`,
    noAnswer: 'Orca did not answer',
    reconnecting: (host) => `Checking ${host} again…`,
    gone: (name, host) => `${name} no longer exists on ${host}; free it: orca game stop`,
    finished: (name, host) => `${name} finished on ${host}; its terminal is closed`,
    silent: (name, host, read) => `${host} does not answer; read ${name}: ${read}`,
    live: (name, host, read) => `${name} runs on ${host}; read it: ${read}`
  },
  es: {
    goneTag: (host) => `ya no está en ${host}`,
    asleepTags: (host) => [`dormido en ${host}`, `${host} dormido`],
    resume: 'Reanudar',
    reconnect: 'Reconectar',
    waking: (name, host) => `Despertando a ${name} en ${host}…`,
    woke: (name, host) => `${name} despertó en ${host}`,
    notResumed: (name, reason) => `No se pudo reanudar a ${name}: ${reason}`,
    noAnswer: 'Orca no respondió',
    reconnecting: (host) => `Volviendo a consultar ${host}…`,
    gone: (name, host) => `${name} ya no existe en ${host}; libéralo: orca game stop`,
    finished: (name, host) => `${name} terminó en ${host}; su terminal está cerrada`,
    silent: (name, host, read) => `${host} no responde; lee a ${name}: ${read}`,
    live: (name, host, read) => `${name} corre en ${host}; léelo: ${read}`
  }
}

export const remoteGoneTagOf = (host: string): string => REMOTE_TEXT[gameLocale()].goneTag(host)

export const remoteAsleepTagsOf = (host: string): [string, string] =>
  REMOTE_TEXT[gameLocale()].asleepTags(host)

export type RemoteRecovery = {
  action: 'resume' | 'reconnect'
  label: string
  ticket: string | null
}

/** The card action that brings back a remote member a host restart slept or a dropped link hid. */
export function remoteRecoveryOf(
  agent: Pick<GameAgent, 'paneKey' | 'displayName' | 'remote' | 'workItem'>
): RemoteRecovery | null {
  const remote = agent.remote
  const text = REMOTE_TEXT[gameLocale()]
  // Why the space: NAMED_TICKET wants a title after the ticket, and a launched name may have none.
  const ticket =
    agent.workItem?.identifier ?? NAMED_TICKET.exec(`${agent.displayName} `)?.[2] ?? null
  if (remote?.asleep) {
    return { action: 'resume', label: text.resume, ticket }
  }
  return remote && !remote.stateKnown && !remote.gone
    ? { action: 'reconnect', label: text.reconnect, ticket }
    : null
}

/** What View says for a remote member, whose handle only resolves on its host; null for a local one. */
export function remoteViewNoticeOf(
  agent: Pick<GameAgent, 'paneKey' | 'displayName' | 'state' | 'remote'>
): string | null {
  const remote = agent.remote
  if (!remote) {
    return null
  }
  const text = REMOTE_TEXT[gameLocale()]
  const name = agent.displayName ?? agent.paneKey
  const read = `orca orchestration worker-read --dispatch ${agent.paneKey.replace(/^remote:/, '')}`
  if (remote.gone) {
    return agent.state === 'done' ? text.finished(name, remote.host) : text.gone(name, remote.host)
  }
  return remote.stateKnown
    ? text.live(name, remote.host, read)
    : text.silent(name, remote.host, read)
}

export const remoteRecoveryTextOf = () => REMOTE_TEXT[gameLocale()]

/** What a member's card button says: View, or how to bring back a remote one (ORCA-915). */
export const viewLabelOf = (agent: GameAgent): string =>
  remoteRecoveryOf(agent)?.label ?? gameStrings().text.view

/** The toast after Resume ran `game resume-members` for one ticket; `out` is undefined when it never ran. */
export function resumeToastOf(
  name: string,
  host: string,
  ticket: string,
  out: { ok: boolean; stdout: string } | undefined
): string {
  const text = REMOTE_TEXT[gameLocale()]
  let member: { result?: unknown; reason?: unknown } | undefined
  try {
    const parsed = JSON.parse(out?.stdout ?? '') as {
      result?: { members?: { ticket?: unknown; result?: unknown; reason?: unknown }[] }
    }
    member = parsed.result?.members?.find((one) => one.ticket === ticket)
  } catch {
    member = undefined
  }
  if (out?.ok && (member?.result === 'woken' || member?.result === 'resumed')) {
    return text.woke(name, host)
  }
  return text.notResumed(name, typeof member?.reason === 'string' ? member.reason : text.noAnswer)
}
