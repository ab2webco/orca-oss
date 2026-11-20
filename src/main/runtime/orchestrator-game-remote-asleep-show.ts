import type { RemoteGameMemberShow } from './orchestrator-game-remote-members'

/** What a host's federationShow says of a member a restart slept (ORCA-915); null for anything else. */
export function remoteAsleepShowOf(value: unknown): RemoteGameMemberShow | null {
  const asleep = value as { terminal?: unknown; branch?: unknown; title?: unknown } | null
  if (typeof asleep?.terminal !== 'string' || typeof asleep.branch !== 'string') {
    return null
  }
  return {
    branch: asleep.branch,
    title: typeof asleep.title === 'string' ? asleep.title : null,
    liveness: 'sleeping',
    asleep: true
  }
}
