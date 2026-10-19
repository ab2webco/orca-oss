import { z } from 'zod'
import type {
  MobileInstallRequestResult,
  MobileInstallRequestState
} from '../../../src/shared/remote-server-update'

// Mirrors MOBILE_REMOTE_UPDATE_INSTALL_RUNTIME_CAPABILITY in src/shared/protocol-version.ts.
export const MOBILE_REMOTE_UPDATE_INSTALL_CAPABILITY = 'mobile.remote-update-install.v1'

export function isRemoteUpdateInstallSupportedByHost(capabilities: readonly string[]): boolean {
  return capabilities.includes(MOBILE_REMOTE_UPDATE_INSTALL_CAPABILITY)
}

const requestStateSchema = z.object({
  requestId: z.string(),
  deviceName: z.string(),
  phase: z.enum(['downloading', 'countdown']),
  deadlineAt: z.number().nullable()
}) satisfies z.ZodType<MobileInstallRequestState>

const snapshotSchema = z.object({
  appVersion: z.string(),
  support: z.object({ installMode: z.string(), automatic: z.boolean() }),
  status: z.object({ state: z.string(), version: z.string().optional() }),
  mobileInstallRequest: requestStateSchema.nullable().optional()
})

const resultSchema = z.union([
  z.object({ accepted: z.literal(true), request: requestStateSchema }),
  z.object({
    accepted: z.literal(false),
    reason: z.enum(['disabled', 'not-available', 'agents-working']),
    agents: z.array(z.object({ paneKey: z.string(), agentType: z.string().optional() }))
  })
]) satisfies z.ZodType<MobileInstallRequestResult>

export type RemoteUpdateOffer = {
  currentVersion: string
  version: string
  canRequest: boolean
  request: MobileInstallRequestState | null
}

/** The update the desktop's own feed offers, or null when the phone has nothing to ask for. */
export function parseRemoteUpdateOffer(raw: unknown): RemoteUpdateOffer | null {
  const parsed = snapshotSchema.safeParse(raw)
  if (!parsed.success) {
    return null
  }
  const { appVersion, support, status } = parsed.data
  const request = parsed.data.mobileInstallRequest ?? null
  // Why: mirrors the host's own gate so the button never offers a request it refuses.
  const installable = support.automatic && support.installMode === 'interactive'
  const offered = status.state === 'available' || status.state === 'downloaded'
  if (!installable || !status.version || (!offered && !request)) {
    return null
  }
  return {
    currentVersion: appVersion,
    version: status.version,
    canRequest: offered && !request,
    request
  }
}

export function parseMobileInstallResult(raw: unknown): MobileInstallRequestResult | null {
  const parsed = resultSchema.safeParse(raw)
  return parsed.success ? parsed.data : null
}

export type MobileInstallOutcome = {
  tone: 'info' | 'warning'
  message: string
  interrupted: string[]
}

export function describeMobileInstallResult(
  result: MobileInstallRequestResult
): MobileInstallOutcome {
  if (result.accepted) {
    return {
      tone: 'info',
      message:
        result.request.phase === 'countdown'
          ? 'The desktop restarts when its countdown ends. To stop it, cancel it on the desktop.'
          : 'The desktop is downloading the update, then shows a countdown before it restarts. To stop it, cancel it on the desktop.',
      interrupted: []
    }
  }
  if (result.reason === 'agents-working') {
    return {
      tone: 'warning',
      message:
        'Agents are working on this desktop, so it did not restart. Installing would interrupt:',
      interrupted: result.agents.map((agent) => `${agent.agentType ?? 'Agent'} (${agent.paneKey})`)
    }
  }
  return {
    tone: 'warning',
    message:
      result.reason === 'disabled'
        ? 'This desktop does not accept installs from a phone. Turn on "Update from a paired phone" in Settings > General > Updates.'
        : 'This desktop has no update to install right now.',
    interrupted: []
  }
}
