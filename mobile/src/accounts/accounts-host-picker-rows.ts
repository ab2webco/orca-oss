import type { ConnectionState } from '../transport/types'

export type AccountsHostPickerRow = {
  id: string
  name: string
  status: string
  tone: 'green' | 'amber' | 'red' | 'muted'
  current: boolean
}

function statusOf(
  state: ConnectionState | undefined,
  claudeCount: number | undefined
): Pick<AccountsHostPickerRow, 'status' | 'tone'> {
  switch (state) {
    case 'connected': {
      // Why no count until read: "0 Claude accounts" from a snapshot never loaded would be a guess.
      const count =
        claudeCount === undefined
          ? ''
          : ` · ${claudeCount} Claude account${claudeCount === 1 ? '' : 's'}`
      return { status: `Connected${count}`, tone: 'green' }
    }
    case 'connecting':
    case 'handshaking':
    case 'reconnecting':
      return { status: 'Connecting…', tone: 'amber' }
    case 'auth-failed':
      return { status: 'Pairing invalid', tone: 'red' }
    case 'disconnected':
      return { status: "Can't reach desktop", tone: 'red' }
    default:
      return { status: 'Not connected', tone: 'muted' }
  }
}

/** The "Accounts on" sheet's rows: every paired host, its state and Claude account count, the open one marked. */
export function accountsHostPickerRowsOf(args: {
  hosts: readonly { id: string; name: string }[]
  states: Readonly<Partial<Record<string, ConnectionState>>>
  claudeCounts: Readonly<Partial<Record<string, number>>>
  currentHostId: string
}): AccountsHostPickerRow[] {
  return args.hosts.map((host) => ({
    id: host.id,
    name: host.name,
    ...statusOf(args.states[host.id], args.claudeCounts[host.id]),
    current: host.id === args.currentHostId
  }))
}
