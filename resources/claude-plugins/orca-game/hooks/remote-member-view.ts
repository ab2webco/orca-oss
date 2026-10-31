import type { GameAgent, GameLocale } from '../types'
import { gameLocale } from './game-strings'

type RemoteText = {
  goneTag: (host: string) => string
  gone: (name: string, host: string) => string
  finished: (name: string, host: string) => string
  silent: (name: string, host: string, read: string) => string
  live: (name: string, host: string, read: string) => string
}

// Why apart from the catalog: a remote member's terminal lives on its host, and View says so (ORCA-790).
const REMOTE_TEXT: Record<GameLocale, RemoteText> = {
  en: {
    goneTag: (host) => `gone from ${host}`,
    gone: (name, host) => `${name} no longer exists on ${host}: orca game rebind or stop`,
    finished: (name, host) => `${name} finished on ${host}; its terminal is closed`,
    silent: (name, host, read) => `${host} does not answer; read ${name}: ${read}`,
    live: (name, host, read) => `${name} runs on ${host}; read it: ${read}`
  },
  es: {
    goneTag: (host) => `ya no está en ${host}`,
    gone: (name, host) => `${name} ya no existe en ${host}: orca game rebind o stop`,
    finished: (name, host) => `${name} terminó en ${host}; su terminal está cerrada`,
    silent: (name, host, read) => `${host} no responde; lee a ${name}: ${read}`,
    live: (name, host, read) => `${name} corre en ${host}; léelo: ${read}`
  }
}

export const remoteGoneTagOf = (host: string): string => REMOTE_TEXT[gameLocale()].goneTag(host)

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
