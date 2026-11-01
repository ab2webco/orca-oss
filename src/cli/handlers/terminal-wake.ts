import type { RuntimeStatus, RuntimeTerminalWake } from '../../shared/runtime-types'
import { TERMINAL_WAKE_RUNTIME_CAPABILITY } from '../../shared/protocol-version'
import type { CommandHandler } from '../dispatch'
import { printResult } from '../format'
import { getOptionalStringFlag, getRequiredStringFlag } from '../flags'
import { RuntimeClientError } from '../runtime-client'

export function formatTerminalWake(result: { wake: RuntimeTerminalWake }, asked: string): string {
  const { wake } = result
  if (wake.status === 'awake') {
    return `Terminal ${asked} is already running.`
  }
  if (wake.status === 'woken' && wake.handle) {
    return `Woke ${asked}; its agent now runs as ${wake.handle}.`
  }
  return `Wake started for ${asked}; its agent is still starting. Run \`orca terminal list\` to get its new handle.`
}

/** Wakes a sleeping agent terminal as its host's UI does; `--environment` reaches a paired host (ORCA-915). */
export const terminalWakeHandler: CommandHandler = async ({ flags, client, json }) => {
  const terminal = getRequiredStringFlag(flags, 'terminal')
  const host = getOptionalStringFlag(flags, 'environment') ?? 'this machine'
  const status = await client.call<RuntimeStatus>('status.get')
  // Why ask first: an older host has no terminal.wake and would fail as an unknown method.
  if (!status.result?.capabilities?.includes(TERMINAL_WAKE_RUNTIME_CAPABILITY)) {
    throw new RuntimeClientError(
      'unsupported',
      `The Orca Lab on ${host} cannot wake terminals; update it, or wake the terminal from its window.`
    )
  }
  try {
    const result = await client.call<{ wake: RuntimeTerminalWake }>('terminal.wake', { terminal })
    printResult(result, json, (value) => formatTerminalWake(value, terminal))
  } catch (error) {
    if (error instanceof RuntimeClientError && error.code === 'terminal_wake_unavailable') {
      throw new RuntimeClientError(
        error.code,
        `The Orca Lab on ${host} runs without a window, and only its window can wake an agent; open Orca Lab there and retry.`
      )
    }
    throw error
  }
}
