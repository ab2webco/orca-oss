import { useEffect, useMemo, useState } from 'react'
import { ActivityIndicator, Pressable, View } from 'react-native'
import { useRouter } from 'expo-router'
import { ChevronDown, ChevronLeft, RefreshCw } from 'lucide-react-native'
import { loadHomeSnapshot } from '../cache/home-snapshot-cache'
import { Text } from '../theme/dynamic-type-text'
import { colors } from '../theme/mobile-theme'
import { loadHosts } from '../transport/host-store'
import type { ConnectionState } from '../transport/types'
import { useAllHostClients } from '../transport/use-all-host-clients'
import { AccountsHostPicker } from './AccountsHostPicker'
import { accountsHostPickerRowsOf } from './accounts-host-picker-rows'
import { styles } from './mobile-accounts-screen-styles'

// Why none: the sheet only reports the connections Home already holds; it never dials a host.
const NO_AUTO_CONNECT: readonly string[] = []

/** A per-desktop screen's title row; the host name opens the "{title} on" sheet to switch desktops. */
export function AccountsHeader(props: {
  hostId: string
  hostName: string | null
  /** The host-stack screen the picker reopens on another desktop. */
  screen?: 'accounts' | 'agent-teams'
  title?: string
  refresh?: { refreshing: boolean; canRefresh: boolean; onRefresh: () => void }
}) {
  const title = props.title ?? 'Accounts'
  const router = useRouter()
  const [pickerOpen, setPickerOpen] = useState(false)
  const [hosts, setHosts] = useState<{ id: string; name: string }[]>([])
  const [claudeCounts, setClaudeCounts] = useState<Record<string, number>>({})
  const clients = useAllHostClients(
    useMemo(() => hosts.map((host) => host.id), [hosts]),
    { autoConnectHostIds: NO_AUTO_CONNECT }
  )

  useEffect(() => {
    if (!pickerOpen) {
      return
    }
    void loadHosts().then((all) => setHosts(all.map(({ id, name }) => ({ id, name }))))
    void loadHomeSnapshot().then((snapshot) =>
      setClaudeCounts(
        Object.fromEntries(
          Object.entries(snapshot?.accountsByHost ?? {}).map(([id, accounts]) => [
            id,
            accounts.claude.accounts.length
          ])
        )
      )
    )
  }, [pickerOpen])

  const states: Partial<Record<string, ConnectionState>> = Object.fromEntries(
    clients.map((entry) => [entry.hostId, entry.state])
  )
  const rows = accountsHostPickerRowsOf({
    hosts,
    states,
    claudeCounts,
    currentHostId: props.hostId
  })

  return (
    <View style={styles.topRow}>
      <Pressable style={styles.backButton} onPress={() => router.back()}>
        <ChevronLeft size={22} color={colors.textPrimary} />
      </Pressable>
      <View style={styles.titleWrap}>
        <Text style={styles.heading}>{title}</Text>
        {props.hostName ? (
          <Pressable style={styles.hostPickerButton} onPress={() => setPickerOpen(true)}>
            <Text style={styles.subheading} numberOfLines={1}>
              {props.hostName}
            </Text>
            <ChevronDown size={14} color={colors.textSecondary} />
          </Pressable>
        ) : null}
      </View>
      {props.refresh ? (
        <Pressable
          style={styles.iconButton}
          onPress={props.refresh.onRefresh}
          disabled={!props.refresh.canRefresh}
        >
          {props.refresh.refreshing ? (
            <ActivityIndicator size="small" color={colors.textSecondary} />
          ) : (
            <RefreshCw size={18} color={colors.textSecondary} />
          )}
        </Pressable>
      ) : null}
      <AccountsHostPicker
        title={`${title} on`}
        visible={pickerOpen}
        rows={rows}
        onClose={() => setPickerOpen(false)}
        onPick={(hostId) => {
          setPickerOpen(false)
          if (hostId !== props.hostId) {
            router.replace(`/h/${hostId}/${props.screen ?? 'accounts'}`)
          }
        }}
      />
    </View>
  )
}
