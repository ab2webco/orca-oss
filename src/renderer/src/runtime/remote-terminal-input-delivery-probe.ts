import { e2eConfig } from '@/lib/e2e-config'
import type {
  RemoteTerminalInputDeliveryEvent,
  RemoteTerminalInputDeliveryProbe,
  RemoteTerminalInputDeliveryReport,
  RemoteTerminalInputDeliverySite
} from '../../../shared/remote-terminal-input-delivery'

// Why: bounded so a chatty terminal cannot grow the probe without limit.
const MAX_EVENTS_PER_TERMINAL = 32

/** Bucket for input dropped after the transport lost its handle — the loss has no terminal to name. */
export const DETACHED_TRANSPORT_INPUT_KEY = '<detached-transport>'

const reports = new Map<string, RemoteTerminalInputDeliveryReport>()

function cloneReport(report: RemoteTerminalInputDeliveryReport): RemoteTerminalInputDeliveryReport {
  return { totals: { ...report.totals }, events: report.events.map((event) => ({ ...event })) }
}

/** Exposed before any write so a reader can reset the probe ahead of the input it wants to attribute. */
export function exposeRemoteTerminalInputDeliveryProbe(): void {
  if (
    !e2eConfig.exposeStore ||
    typeof window === 'undefined' ||
    window.__remoteTerminalInputDelivery
  ) {
    return
  }
  const probe: RemoteTerminalInputDeliveryProbe = {
    snapshot: () => {
      const snapshot: Record<string, RemoteTerminalInputDeliveryReport> = {}
      for (const [terminal, report] of reports) {
        snapshot[terminal] = cloneReport(report)
      }
      return snapshot
    },
    reset: () => reports.clear()
  }
  window.__remoteTerminalInputDelivery = probe
}

/** Records where one renderer write for `terminal` ended. E2E-gated: the
 *  interactivity specs read it to name the losing site instead of inferring it
 *  from an absent echo. */
export function recordRemoteTerminalInputDelivery(
  terminal: string,
  site: RemoteTerminalInputDeliverySite,
  chars: number
): void {
  if (!e2eConfig.exposeStore) {
    return
  }
  let report = reports.get(terminal)
  if (!report) {
    report = { totals: {}, events: [] }
    reports.set(terminal, report)
  }
  report.totals[site] = (report.totals[site] ?? 0) + chars
  const event: RemoteTerminalInputDeliveryEvent = { site, chars }
  report.events.push(event)
  if (report.events.length > MAX_EVENTS_PER_TERMINAL) {
    report.events.shift()
  }
  exposeRemoteTerminalInputDeliveryProbe()
}
