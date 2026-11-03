export type ParsedDaemonPid = {
  pid: number
  startedAtMs: number | null
  entryPath: string | null
  appVersion: string | null
  launchNonce: string | null
  linuxStartTicks: string | null
  bootId: string | null
  spawnerExecPath: string | null
}

// Why: Number('') is 0, so a record truncated by a power loss parsed as pid 0 — an "owner" no
// cleanup would remove, failing every later daemon's exclusive publish (ORCA-990). kill(0) also
// targets our own process group, so no non-positive pid may name a daemon.
function isDaemonPid(pid: unknown): pid is number {
  return typeof pid === 'number' && Number.isSafeInteger(pid) && pid > 0
}

export function parseDaemonPidFile(contents: string): ParsedDaemonPid | null {
  const trimmed = contents.trim()
  try {
    const parsed = JSON.parse(trimmed) as {
      pid?: unknown
      startedAtMs?: unknown
      entryPath?: unknown
      appVersion?: unknown
      launchNonce?: unknown
      linuxStartTicks?: unknown
      bootId?: unknown
      spawnerExecPath?: unknown
    }
    if (isDaemonPid(parsed.pid)) {
      return {
        pid: parsed.pid,
        startedAtMs:
          typeof parsed.startedAtMs === 'number' && Number.isFinite(parsed.startedAtMs)
            ? parsed.startedAtMs
            : null,
        entryPath: typeof parsed.entryPath === 'string' ? parsed.entryPath : null,
        appVersion: typeof parsed.appVersion === 'string' ? parsed.appVersion : null,
        launchNonce: typeof parsed.launchNonce === 'string' ? parsed.launchNonce : null,
        linuxStartTicks: typeof parsed.linuxStartTicks === 'string' ? parsed.linuxStartTicks : null,
        bootId: typeof parsed.bootId === 'string' ? parsed.bootId : null,
        spawnerExecPath: typeof parsed.spawnerExecPath === 'string' ? parsed.spawnerExecPath : null
      }
    }
  } catch {
    // Legacy daemons wrote the pid file as a bare integer.
  }

  const pid = Number(trimmed)
  return isDaemonPid(pid)
    ? {
        pid,
        startedAtMs: null,
        entryPath: null,
        appVersion: null,
        launchNonce: null,
        linuxStartTicks: null,
        bootId: null,
        spawnerExecPath: null
      }
    : null
}
