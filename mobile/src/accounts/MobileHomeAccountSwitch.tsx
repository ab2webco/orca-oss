import { ChevronRight } from 'lucide-react-native'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import type { AccountsSnapshot, ProviderKey } from '../components/account-usage-state'
import { ClaudeIcon, OpenAIIcon } from '../components/AgentIcons'
import type { HostProfile } from '../transport/types'
import { colors, radii, spacing } from '../theme/mobile-theme'

type Props = {
  connectedHosts: HostProfile[]
  accountsByHost: Partial<Record<string, AccountsSnapshot>>
  onOpenAccounts: (hostId: string) => void
}

export type AccountSwitchRow = {
  hostId: string
  provider: ProviderKey
  subtitle: string
}

function activeEmail(snapshot: AccountsSnapshot, provider: ProviderKey): string {
  const section = snapshot[provider]
  const active = section.accounts.find((account) => account.id === section.activeAccountId)
  return active?.email ?? 'System default'
}

/** Why Codex only as a fallback: this row advertises the Claude switch the user could not find,
 *  so a Claude-less host still gets a truthful label instead of an empty one. */
export function accountSwitchRows(
  connectedHosts: HostProfile[],
  accountsByHost: Partial<Record<string, AccountsSnapshot>>
): AccountSwitchRow[] {
  const showHostName = connectedHosts.length > 1
  return connectedHosts.map((host) => {
    const snapshot = accountsByHost[host.id]
    const provider: ProviderKey =
      snapshot && snapshot.claude.accounts.length === 0 && snapshot.codex.accounts.length > 0
        ? 'codex'
        : 'claude'
    // Why not "System default" here: with no snapshot (or a rejected one) nothing is known,
    // and naming a login the host never reported is the blind switch this series is correcting.
    const account = snapshot ? activeEmail(snapshot, provider) : 'Choose an account'
    return {
      hostId: host.id,
      provider,
      subtitle: showHostName ? `${host.name} · ${account}` : account
    }
  })
}

export function MobileHomeAccountSwitch(props: Props) {
  const rows = accountSwitchRows(props.connectedHosts, props.accountsByHost)
  if (rows.length === 0) {
    return null
  }
  return (
    <>
      <Text style={styles.sectionHeading}>Accounts</Text>
      {rows.map((row) => (
        <Pressable
          key={row.hostId}
          accessibilityRole="button"
          accessibilityLabel={`Switch account — ${row.subtitle}`}
          style={({ pressed }) => [styles.switchCard, pressed && styles.switchCardPressed]}
          onPress={() => props.onOpenAccounts(row.hostId)}
        >
          <View style={styles.switchIcon}>
            {row.provider === 'claude' ? (
              <ClaudeIcon size={18} />
            ) : (
              <OpenAIIcon size={18} color={colors.textPrimary} />
            )}
          </View>
          <View style={styles.switchInfo}>
            <Text style={styles.switchLabel}>Switch account</Text>
            <Text style={styles.switchSubtitle} numberOfLines={1}>
              {row.subtitle}
            </Text>
          </View>
          <ChevronRight size={16} color={colors.textMuted} />
        </Pressable>
      ))}
    </>
  )
}

const styles = StyleSheet.create({
  sectionHeading: {
    marginTop: spacing.xl,
    marginBottom: spacing.sm,
    paddingHorizontal: spacing.xs,
    color: colors.textMuted,
    fontSize: 11,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.6
  },
  switchCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm + 2,
    backgroundColor: colors.bgPanel,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    borderRadius: radii.card,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
    marginBottom: spacing.sm
  },
  switchCardPressed: {
    backgroundColor: colors.bgRaised
  },
  switchIcon: {
    width: 32,
    height: 32,
    borderRadius: 9,
    backgroundColor: colors.bgRaised,
    alignItems: 'center',
    justifyContent: 'center'
  },
  switchInfo: {
    flex: 1,
    minWidth: 0,
    gap: 2
  },
  switchLabel: {
    color: colors.textPrimary,
    fontSize: 14,
    fontWeight: '600'
  },
  switchSubtitle: {
    color: colors.textMuted,
    fontSize: 12
  }
})
