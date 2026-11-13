import { Monitor, MoreVertical, Users } from 'lucide-react-native'
import { Pressable, StyleSheet, View } from 'react-native'
import { Text } from '../theme/dynamic-type-text'
import type { ConnectionVerdict } from '../transport/connection-health'
import { verdictDisplayLabel } from '../transport/connection-health'
import { mobileConnectionPathLabel } from '../transport/mobile-connection-path-label'
import type { MobileConnectionPath } from '../transport/stable-logical-rpc-client'
import type { ConnectionState, HostCatalogEntry, HostProfile } from '../transport/types'
import { colors, radii, spacing } from '../theme/mobile-theme'
import { homeHostWorktreeSummary, type HostWorktreeInfo } from '../worktree/home-worktree-info'
import { hostTeamLineParts, type HostTeamLine } from '../hosts/host-team-line'
import type { HostAccountLine } from '../hosts/host-account-line'
import { usageColorOf } from './usage-color'
import { StatusDot } from './StatusDot'

export function MobileHostCard(props: {
  host: HostProfile | HostCatalogEntry
  credentialStatus?: HostCatalogEntry['credentialStatus']
  state: ConnectionState
  verdict: ConnectionVerdict
  path: MobileConnectionPath
  // Why: the card owns the fresh/stale/unavailable wording so no caller can re-gate the counts
  // away (STA-3123 shipped that bug once already).
  worktreeInfo?: HostWorktreeInfo
  /** The host's team across its live leads; null or absent when the host cannot say (an older desktop). */
  teamLine?: HostTeamLine | null
  /** The active Claude account; shown only while connected, since a dropped host may have switched. */
  account?: HostAccountLine | null
  /** 'last seen HH:MM' for a host that cannot be reached right now. */
  lastSeen?: string | null
  onPress: () => void
  onLongPress: () => void
  onOpenActions: () => void
}) {
  const credentialUnavailable = props.credentialStatus === 'temporarily-unavailable'
  const credentialMissing = props.credentialStatus === 'missing'
  const connected = props.state === 'connected' && !credentialUnavailable && !credentialMissing
  // Why: a relay dial can run for seconds behind "Connecting…"/"Reconnecting…"; naming the
  // path mid-wait tells the user the phone is off-LAN rather than hung (F5). Only 'relay' is
  // named — 'lan' doubles as the unknown-path default, so it would be a guess before connect.
  const dialingPath =
    ['connecting', 'handshaking', 'reconnecting'].includes(props.state) && props.path === 'relay'
  const isError =
    credentialMissing || ['warning', 'unreachable', 'auth-failed'].includes(props.verdict.kind)
  const statusLabel = credentialMissing
    ? 'Pairing invalid'
    : credentialUnavailable
      ? 'Pairing temporarily unavailable'
      : verdictDisplayLabel(props.verdict)
  const statusVerdict: ConnectionVerdict = credentialMissing
    ? { kind: 'auth-failed', label: statusLabel }
    : credentialUnavailable
      ? { kind: 'warning', label: statusLabel }
      : props.verdict
  const worktreeSummary = homeHostWorktreeSummary(props.worktreeInfo)
  // Why only while connected: a team count from a host the phone cannot reach would be a guess.
  // Why: a dropped host keeps the last team it proved, labelled as such, and never claims a live "needs you".
  const teamLine = props.teamLine ?? null
  const teamParts = teamLine && connected ? hostTeamLineParts(teamLine) : null
  const lastKnownTeam =
    teamLine && !connected ? `Last known: ${hostTeamLineParts(teamLine).join(' · ')}` : null
  const needsYouText =
    connected && teamLine && teamLine.needsYou > 0 ? `${teamLine.needsYou} needs you` : null
  const accountLine = connected ? (props.account ?? null) : null
  const connectionPathLabel =
    !credentialMissing && !credentialUnavailable && (connected || dialingPath)
      ? mobileConnectionPathLabel(props.path)
      : null
  const discoveryHint =
    props.verdict.kind === 'unreachable' && !props.host.relay
      ? 'Update desktop Orca Lab and sign in to connect from anywhere'
      : null
  const credentialHint = credentialMissing
    ? 'Tap to re-pair with your desktop'
    : credentialUnavailable
      ? 'Unlock your phone, then tap to retry'
      : null
  const accessibilityLabel = [
    `Open ${props.host.name}`,
    statusLabel,
    connectionPathLabel?.replace(' · ', ' via '),
    connected ? worktreeSummary?.replace(' · ', ', ') : null,
    needsYouText,
    teamParts?.join(', '),
    discoveryHint,
    credentialHint
  ]
    .filter(Boolean)
    .join(', ')
  return (
    <View style={styles.card}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
        style={({ pressed }) => [styles.cardMain, pressed && styles.cardPressed]}
        onPress={props.onPress}
        onLongPress={props.onLongPress}
        delayLongPress={400}
      >
        <View style={styles.icon}>
          <Monitor size={20} color={connected ? colors.textPrimary : colors.textSecondary} />
        </View>
        <View style={styles.main}>
          <Text
            style={[styles.name, !connected && { color: colors.textSecondary }]}
            numberOfLines={1}
          >
            {props.host.name}
          </Text>
          <View style={styles.meta}>
            <StatusDot state={props.state} verdict={statusVerdict} />
            <Text
              style={[
                styles.metaText,
                isError && { color: colors.statusRed },
                credentialUnavailable && { color: colors.statusAmber }
              ]}
              numberOfLines={1}
            >
              {statusLabel}
              {connectionPathLabel ? ` · ${connectionPathLabel}` : ''}
            </Text>
          </View>
          {connected && worktreeSummary ? (
            <Text style={styles.worktreeMetaText} numberOfLines={1}>
              {worktreeSummary}
            </Text>
          ) : null}
          {teamParts || lastKnownTeam ? (
            <View style={styles.teamRow}>
              <Users size={12} color={colors.textMuted} style={styles.teamIcon} />
              {/* Why wrap: on a 320 phone the pieces move to a new line whole instead of being cut. */}
              <View style={styles.teamStack}>
                {needsYouText ? <Text style={styles.teamNeedsText}>{needsYouText}</Text> : null}
                {teamParts?.map((part) => (
                  <Text key={part} style={styles.teamText}>
                    {part}
                  </Text>
                ))}
                {lastKnownTeam ? <Text style={styles.teamText}>{lastKnownTeam}</Text> : null}
                {!connected && props.lastSeen ? (
                  <Text style={styles.teamText}>{props.lastSeen}</Text>
                ) : null}
              </View>
            </View>
          ) : null}
          {accountLine ? (
            <View style={styles.accountRow}>
              <Text style={styles.accountEmail} numberOfLines={1}>
                {accountLine.email}
              </Text>
              {accountLine.fiveHourPercent != null ? (
                <Text
                  style={[
                    styles.accountPercent,
                    { color: usageColorOf(accountLine.fiveHourPercent) }
                  ]}
                >
                  {`${accountLine.fiveHourPercent}%`}
                </Text>
              ) : null}
            </View>
          ) : null}
          {discoveryHint ? (
            <Text style={styles.discoveryHint} numberOfLines={2}>
              {discoveryHint}
            </Text>
          ) : null}
          {credentialHint ? (
            <Text style={styles.discoveryHint} numberOfLines={2}>
              {credentialHint}
            </Text>
          ) : null}
        </View>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Actions for ${props.host.name}`}
        hitSlop={8}
        style={({ pressed }) => [styles.actionButton, pressed && styles.actionButtonPressed]}
        onPress={props.onOpenActions}
      >
        <MoreVertical size={18} color={colors.textSecondary} />
      </Pressable>
    </View>
  )
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: radii.card,
    backgroundColor: colors.bgPanel,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    overflow: 'hidden'
  },
  cardMain: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: spacing.md,
    paddingVertical: 12
  },
  cardPressed: { backgroundColor: colors.bgRaised },
  icon: {
    width: 46,
    height: 46,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.bgRaised,
    marginRight: 14
  },
  main: { flex: 1, minWidth: 0, marginRight: spacing.sm },
  name: { color: colors.textPrimary, fontSize: 15, fontWeight: '600', lineHeight: 20 },
  meta: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 3, minWidth: 0 },
  metaText: { flex: 1, fontSize: 12, color: colors.textSecondary },
  worktreeMetaText: {
    marginTop: 2,
    marginLeft: spacing.xl,
    fontSize: 12,
    color: colors.textMuted
  },
  teamRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 6,
    marginTop: 2,
    marginLeft: spacing.xl,
    minWidth: 0
  },
  teamIcon: { marginTop: 2 },
  accountRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 2,
    marginLeft: spacing.xl,
    minWidth: 0
  },
  accountEmail: { flexShrink: 1, fontSize: 12, color: colors.textSecondary },
  accountPercent: { fontSize: 12, fontWeight: '600' },
  teamStack: { flex: 1, flexDirection: 'row', flexWrap: 'wrap', columnGap: 12, minWidth: 0 },
  teamNeedsText: { fontSize: 12, color: colors.statusRed },
  teamText: { fontSize: 12, color: colors.textMuted },
  discoveryHint: {
    marginTop: spacing.xs,
    fontSize: 11,
    lineHeight: 15,
    color: colors.textMuted
  },
  actionButton: {
    width: 40,
    height: 40,
    marginHorizontal: spacing.xs,
    borderRadius: radii.row,
    alignItems: 'center',
    justifyContent: 'center'
  },
  actionButtonPressed: {
    backgroundColor: colors.bgRaised
  }
})
