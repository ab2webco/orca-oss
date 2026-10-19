import { defineMethod, type RpcMethod } from '../core'
import { z } from 'zod'
import {
  cancelRemoteServerMobileInstall,
  checkRemoteServerUpdater,
  downloadRemoteServerUpdater,
  getRemoteServerUpdaterSnapshot,
  installRemoteServerUpdater,
  requestRemoteServerMobileInstall,
  restartRemoteServerMobileInstallNow
} from '../../remote-server-updater'

const MOBILE_INSTALL_REQUEST_ID_PARAMS = z.object({ requestId: z.string().min(1) }).strict()

export const UPDATER_METHODS: RpcMethod[] = [
  defineMethod({
    name: 'updater.getStatus',
    params: null,
    handler: (_params, { runtime }) => getRemoteServerUpdaterSnapshot(runtime.getRuntimeId())
  }),
  defineMethod({
    name: 'updater.check',
    params: z.object({
      includePrerelease: z.boolean().optional(),
      includePerfPrerelease: z.boolean().optional()
    }),
    handler: (params, { runtime }) => checkRemoteServerUpdater(runtime.getRuntimeId(), params)
  }),
  defineMethod({
    name: 'updater.download',
    params: null,
    handler: (_params, { runtime }) => downloadRemoteServerUpdater(runtime.getRuntimeId())
  }),
  defineMethod({
    name: 'updater.install',
    params: null,
    handler: (_params, { runtime }) => installRemoteServerUpdater(runtime.getRuntimeId())
  }),
  // Why: strict so a phone cannot smuggle a version or URL; the install target is always the feed's offer.
  defineMethod({
    name: 'updater.requestMobileInstall',
    params: z.object({}).strict(),
    handler: (_params, { pairedDeviceId }) => requestRemoteServerMobileInstall(pairedDeviceId ?? '')
  }),
  defineMethod({
    name: 'updater.cancelMobileInstall',
    params: MOBILE_INSTALL_REQUEST_ID_PARAMS,
    handler: (params) => cancelRemoteServerMobileInstall(params.requestId)
  }),
  defineMethod({
    name: 'updater.restartMobileInstallNow',
    params: MOBILE_INSTALL_REQUEST_ID_PARAMS,
    handler: (params) => restartRemoteServerMobileInstallNow(params.requestId)
  })
]
