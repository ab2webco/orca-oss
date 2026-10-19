import type {
  LinuxPackageInstallInstructions,
  ReleaseBuildListResult,
  UpdateCheckOptions,
  UpdateStatus
} from '../../shared/update-status-types'
import type { ReleaseChannel } from '../../shared/release-channel'
import type { MobileInstallRequestState } from '../../shared/remote-server-update'

export type UpdaterApi = {
  getVersion: () => Promise<string>
  getStatus: () => Promise<UpdateStatus>
  check: (options?: UpdateCheckOptions) => Promise<void>
  download: () => Promise<void>
  quitAndInstall: () => Promise<void>
  dismissNudge: () => Promise<void>
  dismissAvailableUpdate: () => Promise<void>
  /** Desktop-only. Rejects unless the current status carries `linux-package-install` recovery. */
  getLinuxPackageInstallInstructions: () => Promise<LinuxPackageInstallInstructions>
  /** Desktop-only. Reveals the revalidated cached package in the native file manager. */
  showLinuxPackage: () => Promise<void>
  listBuilds: (channel: ReleaseChannel) => Promise<ReleaseBuildListResult>

  /** Desktop-only. The paired-phone install request waiting on this window, or null. */
  getMobileInstallRequest: () => Promise<MobileInstallRequestState | null>
  /** Cancel is final for that request; resolves false when the request already ended. */
  cancelMobileInstall: (requestId: string) => Promise<boolean>
  restartMobileInstallNow: (requestId: string) => Promise<boolean>

  onStatus: (callback: (status: UpdateStatus) => void) => () => void
  onMobileInstallRequest: (
    callback: (request: MobileInstallRequestState | null) => void
  ) => () => void
  /** Main asks this window to run its own save-and-restart once the countdown ends. */
  onMobileInstallRestart: (callback: () => void) => () => void
  onClearDismissal: (callback: () => void) => () => void
}
