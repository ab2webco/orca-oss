import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { writeFileAtomically } from '../codex-accounts/fs-utils'
import { getCanonicalUserDataPath } from '../persistence'
import { isDaemonStaleForCurrentBundle } from './daemon-bundle-staleness'
import { readVerifiedDaemonPid } from './daemon-pid-identity'
import { PROTOCOL_VERSION } from './types'

export type DaemonStaleBundleNoticeStatus =
  | { stale: false }
  | { stale: true; pid: number; startedAtMs: number | null; dismissed: boolean }

type StaleBundleNoticeState = { dismissedInstanceKey: string | null }

// Why module-level cache: mirrors macos-tcc-prompt-notice.ts's tally — avoids a disk read on
// every status poll while still reflecting a dismissal written earlier in this process.
let cachedState: StaleBundleNoticeState | null = null

function instanceKey(pid: number, startedAtMs: number | null): string {
  return `${pid}:${startedAtMs ?? 'unknown'}`
}

function noticePath(): string {
  return join(getCanonicalUserDataPath(), 'daemon-stale-bundle-notice.json')
}

function loadState(): StaleBundleNoticeState {
  if (cachedState) {
    return cachedState
  }
  try {
    const parsed = JSON.parse(readFileSync(noticePath(), 'utf8')) as Partial<StaleBundleNoticeState>
    cachedState = {
      dismissedInstanceKey:
        typeof parsed.dismissedInstanceKey === 'string' ? parsed.dismissedInstanceKey : null
    }
  } catch {
    cachedState = { dismissedInstanceKey: null }
  }
  return cachedState
}

/**
 * Permanently silences the notice for exactly this daemon process (pid + start time), so it
 * survives an app relaunch while that same daemon keeps running. A replacement daemon gets a
 * new key and is unaffected — the notice reappears if that one is stale too.
 */
export function dismissStaleBundleNotice(pid: number, startedAtMs: number | null): void {
  cachedState = { dismissedInstanceKey: instanceKey(pid, startedAtMs) }
  try {
    writeFileAtomically(noticePath(), `${JSON.stringify(cachedState, null, 2)}\n`)
  } catch {
    // Best-effort: losing the dismissal only means the notice can reappear once more.
  }
}

export function resetStaleBundleNoticeStateForTests(): void {
  cachedState = null
}

/**
 * Whether the currently adopted daemon predates the packaged app bundle and should surface the
 * "restart to apply terminal fixes" notice.
 *
 * Why the zero-live-session case never reaches "stale: true" here: createOutOfProcessLauncher
 * (daemon-init.ts) already kills and replaces a stale daemon with no live sessions on this same
 * startup, so a stale daemon this function still finds adopted was kept specifically because it
 * owns live sessions — no separate session count check is needed on this path.
 */
export async function getDaemonStaleBundleNoticeStatus(deps: {
  runtimeDir: string
  socketPath: string
  tokenPath: string
  currentAppVersion: string
  isPackaged: boolean
}): Promise<DaemonStaleBundleNoticeStatus> {
  if (!deps.isPackaged) {
    return { stale: false }
  }
  const parsedPid = await readVerifiedDaemonPid(
    deps.runtimeDir,
    deps.socketPath,
    deps.tokenPath,
    PROTOCOL_VERSION
  )
  if (!parsedPid) {
    return { stale: false }
  }
  const stale = await isDaemonStaleForCurrentBundle(
    deps.runtimeDir,
    deps.socketPath,
    deps.tokenPath,
    deps.currentAppVersion
  )
  if (!stale) {
    return { stale: false }
  }
  return {
    stale: true,
    pid: parsedPid.pid,
    startedAtMs: parsedPid.startedAtMs,
    dismissed:
      loadState().dismissedInstanceKey === instanceKey(parsedPid.pid, parsedPid.startedAtMs)
  }
}
