import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native'
import { Text } from '../theme/dynamic-type-text'
import { useHostProtocolGates } from '../components/HostProtocolGate'
import type { RpcClient } from '../transport/rpc-client'
import type { ConnectionState } from '../transport/types'
import { colors, radii, spacing } from '../theme/mobile-theme'
import {
  describeMobileInstallResult,
  isRemoteUpdateInstallSupportedByHost
} from './remote-update-offer'
import { useRemoteUpdateInstall } from './use-remote-update-install'

type Props = {
  client: RpcClient | null
  connState: ConnectionState
}

/** Asks the desktop to install the update its own feed offers; the countdown and Cancel live there. */
export function HostRemoteUpdateRow({ client, connState }: Props) {
  const { hostCapabilities } = useHostProtocolGates()
  const supported = isRemoteUpdateInstallSupportedByHost(hostCapabilities)
  const { offer, outcome, busy, install } = useRemoteUpdateInstall({
    client,
    connState,
    supported
  })
  if (!supported || (!offer && !outcome)) {
    return null
  }
  const shown =
    outcome ??
    (offer?.request
      ? describeMobileInstallResult({ accepted: true, request: offer.request })
      : null)
  return (
    <View style={styles.section}>
      <Text style={styles.heading}>Desktop update</Text>
      {offer ? (
        <View style={styles.offerRow}>
          <Text style={styles.offerText}>
            {`Orca Lab ${offer.version} is ready (this desktop runs ${offer.currentVersion})`}
          </Text>
          {offer.canRequest ? (
            <Pressable
              style={({ pressed }) => [styles.button, pressed && styles.buttonPressed]}
              onPress={install}
              disabled={busy}
              accessibilityRole="button"
              accessibilityLabel={`Install update ${offer.version} on this desktop`}
              accessibilityState={{ disabled: busy, busy }}
            >
              {busy ? (
                <ActivityIndicator size="small" color={colors.onAccent} />
              ) : (
                <Text style={styles.buttonLabel}>Install</Text>
              )}
            </Pressable>
          ) : null}
        </View>
      ) : null}
      {shown ? (
        <View style={styles.outcome}>
          <Text style={[styles.outcomeText, shown.tone === 'warning' && styles.outcomeWarning]}>
            {shown.message}
          </Text>
          {shown.interrupted.map((agent) => (
            <Text key={agent} style={styles.agent}>
              {agent}
            </Text>
          ))}
        </View>
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  section: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.borderSubtle
  },
  heading: {
    paddingHorizontal: spacing.xs,
    marginBottom: spacing.sm,
    color: colors.textMuted,
    fontSize: 11,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.6
  },
  offerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.xs
  },
  offerText: {
    flex: 1,
    color: colors.textPrimary,
    fontSize: 13
  },
  button: {
    minHeight: 44,
    minWidth: 88,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
    borderRadius: radii.button,
    backgroundColor: colors.accentBlue
  },
  buttonPressed: {
    opacity: 0.8
  },
  buttonLabel: {
    color: colors.onAccent,
    fontSize: 14,
    fontWeight: '600'
  },
  outcome: {
    marginTop: spacing.sm,
    paddingHorizontal: spacing.xs,
    gap: 2
  },
  outcomeText: {
    color: colors.textSecondary,
    fontSize: 12
  },
  outcomeWarning: {
    color: colors.statusAmber
  },
  agent: {
    color: colors.textPrimary,
    fontSize: 12
  }
})
