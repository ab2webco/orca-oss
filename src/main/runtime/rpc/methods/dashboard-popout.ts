import { defineMethod, type RpcMethod } from '../core'
import { DashboardPopoutSet } from './dashboard-popout-schemas'

export const DASHBOARD_POPOUT_METHODS: RpcMethod[] = [
  defineMethod({
    name: 'dashboardPopout.get',
    params: null,
    handler: (_params, { runtime }) => ({ open: runtime.getDashboardPopoutOpen() })
  }),
  defineMethod({
    name: 'dashboardPopout.set',
    params: DashboardPopoutSet,
    handler: (params, { runtime }) => runtime.setDashboardPopoutOpen(params.open)
  })
]
