import type { UpdateStatus } from './update-status-types'

export const REMOTE_SERVER_UPDATE_CAPABILITY = 'updater.remote-control.v1' as const

export type RemoteServerUpdateInstallMode =
  | 'interactive'
  | 'supervised-headless-serve'
  | 'unsupported-headless-serve'

export type RemoteServerUpdateSupport = {
  installMode: RemoteServerUpdateInstallMode
  automatic: boolean
  reason:
    | 'available'
    | 'manual-service-update-required'
    | 'unpackaged-build'
    | 'updater-unavailable'
}

export type MobileInstallBlockingAgent = {
  paneKey: string
  agentType?: string
}

export type MobileInstallDenialReason = 'disabled' | 'not-available' | 'agents-working'

export type MobileInstallRequestState = {
  requestId: string
  deviceName: string
  phase: 'downloading' | 'countdown'
  deadlineAt: number | null
}

export type MobileInstallRequestResult =
  | { accepted: true; request: MobileInstallRequestState }
  | { accepted: false; reason: MobileInstallDenialReason; agents: MobileInstallBlockingAgent[] }

export type RemoteServerUpdaterSnapshot = {
  appVersion: string
  runtimeId: string
  support: RemoteServerUpdateSupport
  status: UpdateStatus
  // Why: optional so an older phone-facing snapshot consumer keeps parsing.
  mobileInstallRequest?: MobileInstallRequestState | null
}

export type RemoteServerUpdateInstallResult = {
  accepted: true
  fromVersion: string
  targetVersion: string
  runtimeId: string
}
