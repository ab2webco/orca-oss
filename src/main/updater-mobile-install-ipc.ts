import type { MobileInstallRequestState } from '../shared/remote-server-update'

type IpcRegistry = {
  handle: (
    channel: string,
    listener: (event: { sender: unknown }, ...args: unknown[]) => unknown
  ) => void
  removeHandler: (channel: string) => void
}

export type MobileInstallRequestIpcDeps = {
  ipc: IpcRegistry
  isTrustedSender: (sender: unknown) => boolean
  getRequest: () => MobileInstallRequestState | null
  cancel: (requestId: string) => boolean
  restartNow: (requestId: string) => boolean
}

function readRequestId(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error('Invalid mobile install request id')
  }
  return value
}

export function registerMobileInstallRequestIpc(deps: MobileInstallRequestIpcDeps): void {
  const { ipc } = deps
  const guarded =
    (relay: (requestId: string) => boolean) =>
    (event: { sender: unknown }, requestId: unknown): boolean => {
      // Why: Restart now quits the app, so only the app's own window may press it.
      if (!deps.isTrustedSender(event.sender)) {
        throw new Error('Unauthorized mobile install sender')
      }
      return relay(readRequestId(requestId))
    }

  ipc.removeHandler('updater:getMobileInstallRequest')
  ipc.removeHandler('updater:cancelMobileInstall')
  ipc.removeHandler('updater:restartMobileInstallNow')
  ipc.handle('updater:getMobileInstallRequest', () => deps.getRequest())
  ipc.handle('updater:cancelMobileInstall', guarded(deps.cancel))
  ipc.handle('updater:restartMobileInstallNow', guarded(deps.restartNow))
}
