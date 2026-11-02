import { useCallback, useEffect, useState } from 'react'
import { ActivityIndicator, Pressable, View } from 'react-native'
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context'
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router'
import { ChevronLeft, RefreshCw } from 'lucide-react-native'
import { Text } from '../../../src/theme/dynamic-type-text'
import { colors } from '../../../src/theme/mobile-theme'
import { styles } from '../../../src/accounts/mobile-accounts-screen-styles'
import { loadHosts } from '../../../src/transport/host-store'
import { useHostClient } from '../../../src/transport/client-context'
import { useNow } from '../../../src/hooks/use-now'
import { openMobilePrUrl } from '../../../src/components/mobile-pr-url'
import { GameInboxList } from '../../../src/game-inbox/GameInboxList'
import { useGameOwnerQuestions } from '../../../src/game-inbox/use-game-owner-questions'

export default function GameInboxScreen() {
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const { hostId } = useLocalSearchParams<{ hostId: string }>()
  const { client, state: connState } = useHostClient(hostId)
  const connected = connState === 'connected'
  const [focused, setFocused] = useState(false)
  // Why focus-driven: a question answered on the desktop must leave this list when the person comes back.
  const inbox = useGameOwnerQuestions(client, connected, focused)
  const { reload } = inbox
  const [hostName, setHostName] = useState('')
  const now = useNow(60_000, focused)

  useEffect(() => {
    if (!hostId) {
      return
    }
    let stale = false
    void loadHosts().then((hosts) => {
      if (!stale) {
        setHostName(hosts.find((host) => host.id === hostId)?.name ?? '')
      }
    })
    return () => {
      stale = true
    }
  }, [hostId])

  useFocusEffect(
    useCallback(() => {
      setFocused(true)
      return () => setFocused(false)
    }, [])
  )

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
          <Text style={styles.heading}>Inbox</Text>
          {hostName ? (
            <Text style={styles.subheading} numberOfLines={1}>
              {hostName}
            </Text>
          ) : null}
        </View>
        <Pressable
          style={styles.iconButton}
          onPress={() => void reload()}
          disabled={!connected || inbox.refreshing}
          accessibilityRole="button"
          accessibilityLabel="Refresh questions"
        >
          {inbox.refreshing ? (
            <ActivityIndicator size="small" color={colors.textSecondary} />
          ) : (
            <RefreshCw size={18} color={colors.textSecondary} />
          )}
        </Pressable>
      </View>
      <GameInboxList
        connecting={!connected}
        state={inbox.state}
        refreshing={inbox.refreshing}
        refreshError={inbox.refreshError}
        now={now}
        bottomInset={insets.bottom}
        onRefresh={() => void reload()}
        onAnswer={inbox.answer}
        onOpenLink={openMobilePrUrl}
      />
    </SafeAreaView>
  )
}
