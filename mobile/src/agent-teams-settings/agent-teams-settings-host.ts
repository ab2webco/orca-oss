/** Settings → Agent Teams opens on the desktop the phone reached last; null before any pairing. */
export function agentTeamsSettingsRouteOf(
  hosts: readonly { id: string; lastConnected: number }[]
): { pathname: '/h/[hostId]/agent-teams'; params: { hostId: string } } | null {
  const latest = hosts.reduce<{ id: string; lastConnected: number } | null>(
    (best, host) => (!best || host.lastConnected > best.lastConnected ? host : best),
    null
  )
  return latest ? { pathname: '/h/[hostId]/agent-teams', params: { hostId: latest.id } } : null
}
