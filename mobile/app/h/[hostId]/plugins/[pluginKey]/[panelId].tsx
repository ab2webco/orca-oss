import { useCallback, useState } from 'react'
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, View } from 'react-native'
import { Text } from '../../../../../src/theme/dynamic-type-text'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router'
import { ChevronLeft, RefreshCw, X } from 'lucide-react-native'
import { useHostClient } from '../../../../../src/transport/client-context'
import { useHostProtocolGates } from '../../../../../src/components/HostProtocolGate'
import { colors } from '../../../../../src/theme/mobile-theme'
import { styles } from '../../../../../src/plugin-panels/plugin-panel-screen-styles'
import { arePluginPanelsSupportedByHost } from '../../../../../src/plugin-panels/plugin-panel-list'
import { usePluginPanelSession } from '../../../../../src/plugin-panels/use-plugin-panel-session'
import { PluginPanelWebView } from '../../../../../src/plugin-panels/PluginPanelWebView'

export default function PluginPanelScreen() {
  const { hostId, pluginKey, panelId, title } = useLocalSearchParams<{
    hostId: string
    pluginKey: string
    panelId: string
    title?: string
  }>()
  const router = useRouter()
  const { client, state: connState } = useHostClient(hostId)
  const { hostCapabilities } = useHostProtocolGates()
  const supported = arePluginPanelsSupportedByHost(hostCapabilities)
  const { session, state, foreground, deliveryUnknownAction, dismissDeliveryUnknown } =
    usePluginPanelSession({
      client: supported ? client : null,
      connState,
      pluginKey,
      panelId
    })
  const [unresponsive, setUnresponsive] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)
  // Why: Android pauses a WebView covered by another screen, so its pongs stop
  // and the watchdog would suspend a healthy panel.
  const [focused, setFocused] = useState(true)
  useFocusEffect(
    useCallback(() => {
      setFocused(true)
      return () => setFocused(false)
    }, [])
  )

  const close = useCallback(() => router.back(), [router])
  const reload = () => {
    setUnresponsive(false)
    setReloadKey((value) => value + 1)
    if (state.status !== 'ready') {
      session?.retry()
    }
  }

  const renderBody = () => {
    if (!supported) {
      return <Message text="Update Orca on the computer to open plugin panels from the phone." />
    }
    if (state.status === 'unavailable') {
      return (
        <Message text="This panel is not available. The plugin may be disabled or waiting for approval on the computer." />
      )
    }
    if (state.status === 'error') {
      return <Message text={`The panel could not be loaded — ${state.message}`} onRetry={reload} />
    }
    if (unresponsive) {
      return <Message text="This panel stopped responding and was suspended." onRetry={reload} />
    }
    if (state.status === 'loading' || !session) {
      return <Message text="Loading panel…" busy />
    }
    return (
      <PluginPanelWebView
        key={`${state.documentRevision}:${reloadKey}`}
        shellHtml={state.html}
        session={session}
        active={foreground && focused}
        onUnresponsive={() => setUnresponsive(true)}
        onCloseRequested={close}
      />
    )
  }

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <View style={styles.topRow}>
        <Pressable
          style={styles.backButton}
          onPress={close}
          accessibilityRole="button"
          accessibilityLabel="Back"
        >
          <ChevronLeft size={22} color={colors.textPrimary} />
        </Pressable>
        <View style={styles.titleWrap}>
          <Text style={styles.heading} numberOfLines={1}>
            {title || panelId}
          </Text>
          {connState !== 'connected' ? (
            <Text style={styles.subheading} numberOfLines={1}>
              Reconnecting…
            </Text>
          ) : null}
        </View>
        <Pressable
          style={styles.iconButton}
          onPress={reload}
          accessibilityRole="button"
          accessibilityLabel="Reload panel"
        >
          <RefreshCw size={18} color={colors.textSecondary} />
        </Pressable>
      </View>
      {deliveryUnknownAction ? (
        <View style={styles.banner}>
          <Text style={styles.bannerText}>
            The connection dropped before Orca confirmed “{deliveryUnknownAction}”. It may have been
            applied — check the panel before trying again.
          </Text>
          <Pressable
            onPress={dismissDeliveryUnknown}
            accessibilityRole="button"
            accessibilityLabel="Dismiss"
          >
            <X size={16} color={colors.textSecondary} />
          </Pressable>
        </View>
      ) : null}
      <KeyboardAvoidingView
        style={styles.panelBody}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        {renderBody()}
      </KeyboardAvoidingView>
    </SafeAreaView>
  )
}

function Message({ text, busy, onRetry }: { text: string; busy?: boolean; onRetry?: () => void }) {
  return (
    <View style={styles.placeholder}>
      {busy ? <ActivityIndicator color={colors.textSecondary} /> : null}
      <Text style={styles.placeholderText}>{text}</Text>
      {onRetry ? (
        <Pressable style={styles.retryButton} onPress={onRetry} accessibilityRole="button">
          <Text style={styles.retryText}>Try again</Text>
        </Pressable>
      ) : null}
    </View>
  )
}
