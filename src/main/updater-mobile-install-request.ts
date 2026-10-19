import type { UpdateStatus } from '../shared/update-status-types'
import type {
  MobileInstallBlockingAgent,
  MobileInstallRequestResult,
  MobileInstallRequestState
} from '../shared/remote-server-update'

export const MOBILE_INSTALL_COUNTDOWN_MS = 30_000

export type MobileInstallControllerDeps = {
  isOptedIn: () => boolean
  isInstallSupported: () => boolean
  getUpdateState: () => UpdateStatus['state']
  download: () => void
  install: () => void
  listWorkingAgents: () => MobileInstallBlockingAgent[]
  now: () => number
  setTimer: (fire: () => void, delayMs: number) => () => void
  countdownMs: number
  createRequestId: () => string
  onChange: (request: MobileInstallRequestState | null) => void
}

export type MobileInstallRequestController = {
  request: (deviceName: string) => MobileInstallRequestResult
  cancel: (requestId: string) => boolean
  restartNow: (requestId: string) => boolean
  onUpdateStateChange: (state: UpdateStatus['state']) => void
  current: () => MobileInstallRequestState | null
}

export function createMobileInstallRequestController(
  deps: MobileInstallControllerDeps
): MobileInstallRequestController {
  let active: MobileInstallRequestState | null = null
  let cancelTimer: (() => void) | null = null

  const clearActive = (): void => {
    cancelTimer?.()
    cancelTimer = null
    active = null
    deps.onChange(null)
  }

  const runInstall = (): void => {
    try {
      deps.install()
    } catch {
      clearActive()
    }
  }

  const armCountdown = (): void => {
    const deadlineAt = deps.now() + deps.countdownMs
    const requestId = active?.requestId
    if (!active || !requestId) {
      return
    }
    active = { ...active, phase: 'countdown', deadlineAt }
    cancelTimer = deps.setTimer(() => expire(requestId), deps.countdownMs)
    deps.onChange(active)
  }

  const expire = (requestId: string): void => {
    if (active?.requestId !== requestId || active.phase !== 'countdown') {
      return
    }
    cancelTimer = null
    // Why: opt-in or agents can change during the countdown; a timeout must not install over them.
    const blocked = !deps.isOptedIn() || deps.listWorkingAgents().length > 0
    if (blocked) {
      clearActive()
      return
    }
    active = null
    deps.onChange(null)
    runInstall()
  }

  return {
    request(deviceName) {
      if (active) {
        return { accepted: true, request: active }
      }
      if (!deps.isOptedIn()) {
        return { accepted: false, reason: 'disabled', agents: [] }
      }
      const agents = deps.listWorkingAgents()
      if (agents.length > 0) {
        return { accepted: false, reason: 'agents-working', agents }
      }
      const updateState = deps.getUpdateState()
      if (
        !deps.isInstallSupported() ||
        (updateState !== 'available' && updateState !== 'downloaded')
      ) {
        return { accepted: false, reason: 'not-available', agents: [] }
      }
      active = {
        requestId: deps.createRequestId(),
        deviceName,
        phase: 'downloading',
        deadlineAt: null
      }
      if (updateState === 'downloaded') {
        armCountdown()
      } else {
        deps.onChange(active)
        deps.download()
      }
      return { accepted: true, request: active }
    },
    cancel(requestId) {
      if (active?.requestId !== requestId) {
        return false
      }
      clearActive()
      return true
    },
    restartNow(requestId) {
      if (active?.requestId !== requestId || active.phase !== 'countdown') {
        return false
      }
      cancelTimer?.()
      cancelTimer = null
      active = null
      deps.onChange(null)
      runInstall()
      return true
    },
    onUpdateStateChange(state) {
      if (!active || active.phase !== 'downloading') {
        return
      }
      if (state === 'downloaded') {
        armCountdown()
      } else if (state === 'error' || state === 'not-available' || state === 'idle') {
        clearActive()
      }
    },
    current() {
      return active
    }
  }
}
