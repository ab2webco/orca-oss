import type { InjectedClaudePtyBindingPersistence } from './injected-claude-pty-binding'

export type ClaudeLivePtyPersistence = InjectedClaudePtyBindingPersistence & {
  addClaudeLivePtySessionId(
    sessionId: string,
    accountId?: string | null,
    options?: { accountResolved?: boolean }
  ): void
  removeClaudeLivePtySessionId(sessionId: string): void
}

let persistence: ClaudeLivePtyPersistence | null = null

export function attachClaudeLivePtyPersistence(target: ClaudeLivePtyPersistence | null): void {
  persistence = target
}

export function getClaudeLivePtyPersistence(): ClaudeLivePtyPersistence | null {
  return persistence
}
