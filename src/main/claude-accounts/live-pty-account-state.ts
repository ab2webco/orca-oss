export const liveClaudePtyIds = new Set<string>()
export const liveSharedClaudePtyAccounts = new Map<string, string | null>()
// Why the separate set: `null` in liveSharedClaudePtyAccounts means "this shared
// PTY owns no managed account" — a launch that ran against the user's own login.
// Unknown ownership is a different answer and belongs to ids in this set, which
// is the ONLY thing that may act as a wildcard against every account (ORCA-190).
export const unknownOwnerSharedClaudePtyIds = new Set<string>()
export const liveInjectedClaudePtyAccounts = new Map<string, string>()
export const injectedClaudeLaunchReservations = new Map<string, string>()
export const sharedClaudeLaunchReservations = new Map<string, string | null>()
