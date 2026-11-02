import type {
  ComputerUsePermissionId,
  ComputerUsePermissionResetResult,
  ComputerUsePermissionSetupResult,
  ComputerUsePermissionStatusResult
} from '../../shared/computer-use-permissions-types'
import type {
  DeveloperPermissionId,
  DeveloperPermissionRequestResult,
  DeveloperPermissionState,
  LocalNetworkConnectionTestResult
} from '../../shared/developer-permissions-types'
import type {
  GameInboxNotificationTarget,
  NotificationDeliveryProbeResult,
  NotificationDismissResult,
  NotificationDispatchRequest,
  NotificationDispatchResult,
  NotificationPermissionStatusResult,
  NotificationSoundResult
} from '../../shared/notification-settings-types'

export type NotificationsApi = {
  dispatch: (args: NotificationDispatchRequest) => Promise<NotificationDispatchResult>
  dismiss: (ids: string[]) => Promise<NotificationDismissResult>
  openSystemSettings: () => Promise<void>
  getPermissionStatus: () => Promise<NotificationPermissionStatusResult>
  probeDelivery: (args?: { force?: boolean }) => Promise<NotificationDeliveryProbeResult>
  playSound: (options?: { force?: boolean; volume?: number }) => Promise<NotificationSoundResult>
  /** The dock/launcher count of open owner questions; 0 clears it. */
  setBadgeCount: (count: number) => Promise<void>
  /** A clicked owner-question notification asks to open that project's Inbox. */
  onOpenGameInbox: (callback: (target: GameInboxNotificationTarget) => void) => () => void
}

export type MacosTccPromptsApi = {
  /** Fires once macOS has raised its Nth consent dialog naming Orca (#9756). */
  onThreshold: (callback: (payload: { promptCount: number }) => void) => () => void
  consumePending: () => Promise<{ claimId: number; promptCount: number } | null>
  acknowledgePending: (claimId: number) => Promise<void>
  releasePending: (claimId: number) => Promise<void>
  dismiss: () => Promise<void>
}

export type DeveloperPermissionsApi = {
  getStatus: () => Promise<DeveloperPermissionState[]>
  request: (args: { id: DeveloperPermissionId }) => Promise<DeveloperPermissionRequestResult>
  openSettings: (args: { id: DeveloperPermissionId }) => Promise<void>
  testLocalNetworkConnection: (args: {
    host: string
    port: number
  }) => Promise<LocalNetworkConnectionTestResult>
}

export type ComputerUsePermissionsApi = {
  getStatus: () => Promise<ComputerUsePermissionStatusResult>
  openSetup: (args?: { id?: ComputerUsePermissionId }) => Promise<ComputerUsePermissionSetupResult>
  reset: () => Promise<ComputerUsePermissionResetResult>
}
