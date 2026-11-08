const NOTIFICATION_COOLDOWN_MS = 5000
// Why: a second renderer path (process exit, parked watcher) replays a finished turn up to ~15 s later (ORCA-1131).
export const REPEATED_COMPLETION_WINDOW_MS = 60_000
const MAX_RECENT_NOTIFICATION_KEYS = 50

function pruneRecentNotifications(
  recentNotifications: Map<string, number>,
  now: number,
  windowMs: number
): void {
  if (recentNotifications.size <= MAX_RECENT_NOTIFICATION_KEYS) {
    return
  }

  for (const [key, ts] of recentNotifications) {
    if (now - ts >= windowMs) {
      recentNotifications.delete(key)
    }
  }

  while (recentNotifications.size > MAX_RECENT_NOTIFICATION_KEYS) {
    const oldest = recentNotifications.keys().next()
    if (oldest.done) {
      break
    }
    recentNotifications.delete(oldest.value)
  }
}

export function reserveNotificationCooldown(
  recentNotifications: Map<string, number>,
  dedupeKey: string,
  now: number,
  windowMs = NOTIFICATION_COOLDOWN_MS
): boolean {
  const lastSentAt = recentNotifications.get(dedupeKey) ?? 0
  if (now - lastSentAt < windowMs) {
    return false
  }
  recentNotifications.delete(dedupeKey)
  recentNotifications.set(dedupeKey, now)
  pruneRecentNotifications(recentNotifications, now, windowMs)
  return true
}

/** Same pane, prompt and text: the same finished turn delivered by another path. */
export function repeatedCompletionKey(
  args: { paneKey?: string; worktreeId?: string; agentPrompt?: string },
  options: { title: string; body: string }
): string {
  return [
    args.paneKey ?? args.worktreeId ?? '',
    args.agentPrompt ?? '',
    options.title,
    options.body
  ].join('\u0000')
}
