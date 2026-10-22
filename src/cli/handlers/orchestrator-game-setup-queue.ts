import type { CommandHandler } from '../dispatch'
import { ORCHESTRATION_WORKER_SETUP_QUEUE_RUNTIME_CAPABILITY } from '../../shared/protocol-version'
import type { RuntimeStatus } from '../../shared/runtime-types'

type Client = Parameters<CommandHandler>[0]['client']

/** Where a member waits for the host's setup slot (ORCA-746). */
export type GameSetupQueue = { position: number; waitingOn: string }

export async function runtimeCapabilitiesOf(client: Client): Promise<readonly string[]> {
  const status = await client.call<RuntimeStatus>('status.get')
  return status.result?.capabilities ?? []
}

/** Asks the host to run this member's setup after the one in flight; an older host cannot. */
export function setupAdmissionOf(
  capabilities: readonly string[]
): { setupAdmission: 'queue' } | Record<string, never> {
  if (capabilities.includes(ORCHESTRATION_WORKER_SETUP_QUEUE_RUNTIME_CAPABILITY)) {
    return { setupAdmission: 'queue' }
  }
  process.stderr.write(
    'This Orca Lab cannot queue member setups, so they run at the same time; update or restart Orca Lab.\n'
  )
  return {}
}

export const formatSetupQueue = (queue: GameSetupQueue, who = ''): string =>
  `queued #${queue.position}${who ? ` · ${who}` : ''}, waiting on ${queue.waitingOn}; it starts by itself`
