import { useEffect, useState } from 'react'
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, View } from 'react-native'
import { Text } from '../../../../src/theme/dynamic-type-text'
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { ChevronLeft, ChevronRight, RefreshCw } from 'lucide-react-native'
import { useHostClient } from '../../../../src/transport/client-context'
import { loadHosts } from '../../../../src/transport/host-store'
import { useHostProtocolGates } from '../../../../src/components/HostProtocolGate'
import { colors, spacing } from '../../../../src/theme/mobile-theme'
import { styles } from '../../../../src/plugin-panels/plugin-panel-screen-styles'
import {
  arePluginPanelsSupportedByHost,
  type HostablePluginPanel
} from '../../../../src/plugin-panels/plugin-panel-list'
import { useHostPluginPanels } from '../../../../src/plugin-panels/use-host-plugin-panels'
import { PluginPanelIcon } from '../../../../src/plugin-panels/PluginPanelIcon'

const SECTIONS = [
  { surface: 'nav', heading: 'Panels' },
  { surface: 'settings', heading: 'Settings' }
] as const

export default function HostPluginPanelsScreen() {
  const { hostId } = useLocalSearchParams<{ hostId: string }>()
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const { client, state: connState } = useHostClient(hostId)
  const { hostCapabilities } = useHostProtocolGates()
  const supported = arePluginPanelsSupportedByHost(hostCapabilities)
  const { panels, error, refreshing, refresh } = useHostPluginPanels({
    client,
    connState,
    supported
  })
  const [hostName, setHostName] = useState('')

  useEffect(() => {
    void loadHosts().then((hosts) => {
      setHostName(hosts.find((host) => host.id === hostId)?.name ?? '')
    })
  }, [hostId])

  const openPanel = (panel: HostablePluginPanel) =>
    router.push({
      pathname: '/h/[hostId]/plugins/[pluginKey]/[panelId]',
      params: { hostId, pluginKey: panel.pluginKey, panelId: panel.panelId, title: panel.title }
    })

  const renderBody = () => {
    if (!supported) {
      return (
        <View style={styles.placeholder}>
          <Text style={styles.placeholderText}>
            Update Orca on {hostName || 'this computer'} to open plugin panels from the phone.
          </Text>
        </View>
      )
    }
    if (panels === null) {
      return (
        <View style={styles.placeholder}>
          {error ? (
            <Text style={styles.errorText}>Could not load plugins — {error}</Text>
          ) : (
            <>
              <ActivityIndicator color={colors.textSecondary} />
              <Text style={styles.placeholderText}>
                {connState === 'connected'
                  ? 'Loading plugins…'
                  : `Connecting to ${hostName || 'host'}…`}
              </Text>
            </>
          )}
        </View>
      )
    }
    if (panels.length === 0) {
      return (
        <View style={styles.placeholder}>
          <Text style={styles.placeholderText}>
            No enabled plugin offers a panel. Install, approve and enable plugins from desktop
            Settings → Plugins.
          </Text>
        </View>
      )
    }
    return SECTIONS.map(({ surface, heading }) => {
      const entries = panels.filter((panel) => panel.surface === surface)
      if (entries.length === 0) {
        return null
      }
      return (
        <View key={surface} style={styles.section}>
          <Text style={styles.sectionHeading}>{heading}</Text>
          <View style={styles.card}>
            {entries.map((panel, index) => (
              <Pressable
                key={`${panel.pluginKey}/${panel.panelId}`}
                style={({ pressed }) => [
                  styles.row,
                  index > 0 && styles.rowDivider,
                  pressed && styles.rowPressed
                ]}
                onPress={() => openPanel(panel)}
                accessibilityRole="button"
                accessibilityLabel={`Open ${panel.title}`}
              >
                <View style={styles.rowIcon}>
                  <PluginPanelIcon
                    icon={panel.icon}
                    iconSvg={panel.iconSvg}
                    size={16}
                    color={colors.textSecondary}
                  />
                </View>
                <View style={styles.rowMain}>
                  <Text style={styles.rowTitle} numberOfLines={1}>
                    {panel.title}
                  </Text>
                  <Text style={styles.rowMeta} numberOfLines={1}>
                    {panel.pluginName}
                  </Text>
                </View>
                <ChevronRight size={18} color={colors.textMuted} />
              </Pressable>
            ))}
          </View>
        </View>
      )
    })
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.topRow}>
        <Pressable
          style={styles.backButton}
          onPress={() => router.back()}
          accessibilityRole="button"
          accessibilityLabel="Back"
        >
          <ChevronLeft size={22} color={colors.textPrimary} />
        </Pressable>
        <View style={styles.titleWrap}>
          <Text style={styles.heading}>Plugins</Text>
          {hostName ? (
            <Text style={styles.subheading} numberOfLines={1}>
              {hostName}
            </Text>
          ) : null}
        </View>
        <Pressable
          style={styles.iconButton}
          onPress={refresh}
          disabled={!supported || refreshing || connState !== 'connected'}
          accessibilityRole="button"
          accessibilityLabel="Refresh plugins"
        >
          {refreshing ? (
            <ActivityIndicator size="small" color={colors.textSecondary} />
          ) : (
            <RefreshCw size={18} color={colors.textSecondary} />
          )}
        </Pressable>
      </View>
      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + spacing.xl }]}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={refresh}
            tintColor={colors.textSecondary}
          />
        }
      >
        {renderBody()}
      </ScrollView>
    </SafeAreaView>
  )
}
