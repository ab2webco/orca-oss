import { TERMINAL_WAKE_RUNTIME_CAPABILITY } from '../../shared/protocol-version'
import type { RuntimeStatus, RuntimeTerminalWake } from '../../shared/runtime-types'

const HOST_READ_TIMEOUT_MS = 15_000
// Why 45 s: the host's own wake waits up to 30 s for the agent to start.
const HOST_WAKE_TIMEOUT_MS = 45_000

type HostCall = (method: string, params: unknown, timeoutMs: number) => Promise<unknown>

/** Wakes a member its paired host slept on restart, through that host's terminal.wake (ORCA-915). */
export async function wakeRemoteMemberOnHost(args: {
  dispatchId: string
  host: string
  call: HostCall
}): Promise<RuntimeTerminalWake> {
  const shown = (await args.call(
    'orchestration.federationShow',
    { dispatchId: args.dispatchId },
    HOST_READ_TIMEOUT_MS
  )) as { terminal?: { handle?: unknown } | null; asleep?: { terminal?: unknown } }
  if (typeof shown.terminal?.handle === 'string') {
    return { handle: shown.terminal.handle, status: 'awake' }
  }
  const asleep = shown.asleep?.terminal
  if (typeof asleep !== 'string') {
    throw new Error(`${args.host} has no terminal of this member, running or asleep.`)
  }
  const status = (await args.call('status.get', undefined, HOST_READ_TIMEOUT_MS)) as RuntimeStatus
  // Why ask first: an older host has no terminal.wake and would fail as an unknown method.
  if (!status.capabilities?.includes(TERMINAL_WAKE_RUNTIME_CAPABILITY)) {
    throw new Error(
      `The Orca Lab on ${args.host} cannot wake terminals; update it, or wake the member in its window.`
    )
  }
  const { wake } = (await args.call(
    'terminal.wake',
    { terminal: asleep },
    HOST_WAKE_TIMEOUT_MS
  )) as { wake: RuntimeTerminalWake }
  return wake
}
