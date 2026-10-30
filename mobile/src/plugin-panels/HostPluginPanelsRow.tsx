import { ChevronRight } from 'lucide-react-native'
import { Pressable, ScrollView, StyleSheet, View } from 'react-native'
import { Text } from '../theme/dynamic-type-text'
import { useHostProtocolGates } from '../components/HostProtocolGate'
import type { RpcClient } from '../transport/rpc-client'
import type { ConnectionState } from '../transport/types'
import { colors, radii, spacing } from '../theme/mobile-theme'
import { PluginPanelIcon } from './PluginPanelIcon'
import { arePluginPanelsSupportedByHost, type HostablePluginPanel } from './plugin-panel-list'
import { useHostPluginPanels } from './use-host-plugin-panels'

type Props = {
  hostId: string | undefined
  client: RpcClient | null
  connState: ConnectionState
  /** The host list's navigator, so the tablet sidebar replaces instead of stacking. */
  open: (target: string) => void
}

function pluginPanelRoute(hostId: string, panel: HostablePluginPanel): string {
  return `/h/${hostId}/plugins/${encodeURIComponent(
    panel.pluginKey
  )}/${encodeURIComponent(panel.panelId)}?title=${encodeURIComponent(panel.title)}`
}

/** One-tap entry to each sidecar plugin panel; settings panels stay on the full Plugins screen. */
export function HostPluginPanelsRow({ hostId, client, connState, open }: Props) {
  const { hostCapabilities } = useHostProtocolGates()
  const supported = arePluginPanelsSupportedByHost(hostCapabilities)
  const { panels } = useHostPluginPanels({ client, connState, supported })
  const navPanels = panels?.filter((panel) => panel.surface === 'nav') ?? []
  // Why: this row is the host view's only way into plugins, so settings-only hosts still get All.
  if (!hostId || !supported || !panels || panels.length === 0) {
    return null
  }
  return (
    <View style={[styles.section, navPanels.length === 0 && styles.sectionHeadingOnly]}>
      <View style={[styles.headingRow, navPanels.length === 0 && styles.headingRowOnly]}>
        <Text style={styles.sectionHeading}>Plugins</Text>
        <Pressable
          style={styles.allButton}
          onPress={() => open(`/h/${hostId}/plugins`)}
          accessibilityRole="button"
          accessibilityLabel="All plugins"
          hitSlop={8}
        >
          <Text style={styles.allLabel}>All</Text>
          <ChevronRight size={12} color={colors.textMuted} />
        </Pressable>
      </View>
      {navPanels.length > 0 ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.cards}
        >
          {navPanels.map((panel) => (
            <Pressable
              key={`${panel.pluginKey}/${panel.panelId}`}
              style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
              onPress={() => open(pluginPanelRoute(hostId, panel))}
              accessibilityRole="button"
              accessibilityLabel={`Open ${panel.title}`}
            >
              <View style={styles.iconTile}>
                <PluginPanelIcon
                  icon={panel.icon}
                  iconSvg={panel.iconSvg}
                  size={16}
                  color={colors.textSecondary}
                />
              </View>
              <View style={styles.cardText}>
                <Text style={styles.cardTitle} numberOfLines={1}>
                  {panel.title}
                </Text>
                <Text style={styles.cardMeta} numberOfLines={1}>
                  {panel.pluginName}
                </Text>
              </View>
            </Pressable>
          ))}
        </ScrollView>
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  section: {
    paddingTop: spacing.sm,
    paddingBottom: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.borderSubtle
  },
  headingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    marginBottom: spacing.sm
  },
  sectionHeadingOnly: {
    paddingBottom: spacing.xs
  },
  headingRowOnly: {
    minHeight: 32,
    marginBottom: 0
  },
  sectionHeading: {
    paddingHorizontal: spacing.xs,
    color: colors.textMuted,
    fontSize: 11,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.6
  },
  allButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    paddingHorizontal: spacing.xs
  },
  allLabel: {
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: '600'
  },
  cards: {
    gap: spacing.sm,
    paddingHorizontal: spacing.md
  },
  card: {
    minHeight: 48,
    maxWidth: 200,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm + 2,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    borderRadius: radii.card,
    backgroundColor: colors.bgPanel
  },
  cardPressed: {
    backgroundColor: colors.bgRaised
  },
  iconTile: {
    width: 28,
    height: 28,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.bgRaised
  },
  cardText: {
    flexShrink: 1
  },
  cardTitle: {
    color: colors.textPrimary,
    fontSize: 13,
    fontWeight: '600'
  },
  cardMeta: {
    marginTop: 1,
    color: colors.textMuted,
    fontSize: 11
  }
})
