import { Pressable, StyleSheet } from 'react-native'
import { Puzzle } from 'lucide-react-native'
import { useHostProtocolGates } from '../components/HostProtocolGate'
import type { ConnectionState } from '../transport/types'
import { colors, radii, spacing } from '../theme/mobile-theme'
import { arePluginPanelsSupportedByHost } from './plugin-panel-list'

type Props = {
  host: string | undefined
  conn: ConnectionState
  open: (path: string) => void
  /** Matches the tablet sidebar's toolbar instead of the phone header. */
  embedded?: boolean
}

/** Host toolbar entry to the plugin panels list; absent on hosts that refuse them. */
export function PluginPanelsButton({ host, conn, open, embedded }: Props) {
  const { hostCapabilities } = useHostProtocolGates()
  if (!host || !arePluginPanelsSupportedByHost(hostCapabilities)) {
    return null
  }
  const connected = conn === 'connected'
  return (
    <Pressable
      style={[
        embedded ? styles.embedded : styles.compact,
        embedded && !connected && styles.disabled
      ]}
      onPress={() => open(`/h/${host}/plugins`)}
      disabled={!connected}
      accessibilityRole="button"
      accessibilityLabel="Plugins"
    >
      <Puzzle size={16} color={connected ? colors.textSecondary : colors.textMuted} />
    </Pressable>
  )
}

const styles = StyleSheet.create({
  embedded: {
    flex: 1,
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radii.button
  },
  disabled: {
    opacity: 0.6
  },
  compact: {
    padding: spacing.xs
  }
})
