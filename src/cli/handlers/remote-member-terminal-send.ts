import type { RuntimeTerminalSend } from '../../shared/runtime-types'
import type { RuntimeRpcSuccess } from '../runtime/types'
import { RuntimeClientError } from '../runtime-client'
import { openHostRuntimeClient } from './orchestrator-game-host-client'

type SendClient = {
  call: <TResult>(method: string, params?: unknown) => Promise<RuntimeRpcSuccess<TResult>>
}

export type TerminalSendResponse = RuntimeRpcSuccess<{ send: RuntimeTerminalSend }>

/** The paired host a member's home names for a remote member's handle; null for any other error. */
export function remoteMemberHostOf(error: unknown): { host: string; environmentId: string } | null {
  if (!(error instanceof RuntimeClientError) || error.code !== 'terminal_handle_stale') {
    return null
  }
  const data = error.data as { host?: unknown; environmentId?: unknown } | undefined
  return typeof data?.host === 'string' && typeof data.environmentId === 'string'
    ? { host: data.host, environmentId: data.environmentId }
    : null
}

/** Calls `method` on `environmentId`'s host, naming that host in any failure so it is never mistaken for home's. */
export async function callOnHost<TResult>(
  host: { host: string; environmentId: string },
  method: string,
  params: Record<string, unknown>,
  openHost: (environment: string) => Promise<SendClient> = openHostRuntimeClient
): Promise<RuntimeRpcSuccess<TResult>> {
  try {
    const there = await openHost(host.environmentId)
    return await there.call<TResult>(method, params)
  } catch (error) {
    const code = error instanceof RuntimeClientError ? error.code : 'remote_runtime_unavailable'
    const message = error instanceof Error ? error.message : String(error)
    throw new RuntimeClientError(code, `On paired host ${host.host}: ${message}`)
  }
}

export const sendOnHost = (
  host: { host: string; environmentId: string },
  params: Record<string, unknown>,
  openHost?: (environment: string) => Promise<SendClient>
): Promise<TerminalSendResponse> => callOnHost(host, 'terminal.send', params, openHost)

/**
 * A terminal call that follows a remote member's handle to the paired host its home names, so a lead
 * need not know which host a member runs on (ORCA-976, ORCA-1301). An older home names no host: its error stands.
 */
export async function callFollowingRemoteMember<TResult>(
  client: SendClient & { isRemote: boolean },
  method: string,
  params: Record<string, unknown>,
  openHost?: (environment: string) => Promise<SendClient>
): Promise<RuntimeRpcSuccess<TResult>> {
  try {
    return await client.call<TResult>(method, params)
  } catch (error) {
    // Why a remote client keeps the error: its environment ids are the host's, not this CLI's.
    const host = client.isRemote ? null : remoteMemberHostOf(error)
    if (!host) {
      throw error
    }
    return await callOnHost<TResult>(host, method, params, openHost)
  }
}

export const sendFollowingRemoteMember = (
  client: SendClient & { isRemote: boolean },
  params: Record<string, unknown>,
  openHost?: (environment: string) => Promise<SendClient>
): Promise<TerminalSendResponse> =>
  callFollowingRemoteMember(client, 'terminal.send', params, openHost)
