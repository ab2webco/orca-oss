import type { CommandHandler } from '../dispatch'
import { printResult } from '../format'
import {
  RuntimeClientError,
  RuntimeRpcFailureError,
  type RuntimeRpcSuccess
} from '../runtime-client'

type DashboardPopoutResult = { open: boolean; changed?: boolean }

function formatState(result: DashboardPopoutResult): string {
  return result.changed === undefined
    ? `Agent Dashboard popout is ${result.open ? 'open' : 'closed'}.`
    : `Agent Dashboard popout is ${result.open ? 'open' : 'closed'}${result.changed ? '.' : ' (already in that state).'}`
}

async function callDashboardPopout<TResult>(
  client: Parameters<CommandHandler>[0]['client'],
  method: string,
  params?: unknown
): Promise<RuntimeRpcSuccess<TResult>> {
  try {
    return await client.call<TResult>(method, params)
  } catch (error) {
    if (error instanceof RuntimeRpcFailureError && error.code === 'method_not_found') {
      throw new RuntimeClientError(
        'method_not_supported',
        'This Orca Lab host is too old to answer dashboard popout commands.'
      )
    }
    throw error
  }
}

export const DASHBOARD_POPOUT_HANDLERS: Record<string, CommandHandler> = {
  'dashboard popout show': async ({ client, json }) => {
    const result = await callDashboardPopout<DashboardPopoutResult>(client, 'dashboardPopout.get')
    printResult(result, json, formatState)
  },
  'dashboard popout open': async ({ client, json }) => {
    const result = await callDashboardPopout<DashboardPopoutResult>(client, 'dashboardPopout.set', {
      open: true
    })
    printResult(result, json, formatState)
  },
  'dashboard popout close': async ({ client, json }) => {
    const result = await callDashboardPopout<DashboardPopoutResult>(client, 'dashboardPopout.set', {
      open: false
    })
    printResult(result, json, formatState)
  }
}
