import { useEffect, useMemo, useRef, useState } from 'react'
import { Platform, StyleSheet } from 'react-native'
import { WebView, type WebViewMessageEvent } from 'react-native-webview'
import * as ExpoCrypto from 'expo-crypto'
import { PANEL_PING_TYPE } from '../../../src/shared/plugins/plugin-panel-bridge'
import {
  PANEL_DESIGN_TOKEN_VALUES,
  buildPanelDesignTokenCssFromValues,
  fillPluginPanelShell,
  type PanelColorScheme
} from '../../../src/shared/plugins/plugin-panel-shell-fill'
import { createPanelWatchdog } from '../../../src/shared/plugins/plugin-panel-watchdog'
import {
  buildPanelDeliverScript,
  buildPluginPanelOuterDocument
} from './plugin-panel-outer-document'
import { createPluginPanelHostRelay } from './plugin-panel-host-relay'
import type { PluginPanelSession } from './plugin-panel-session'
import {
  PLUGIN_PANEL_IOS_WEBVIEW_PROPS,
  PLUGIN_PANEL_WEBVIEW_PROPS,
  createPanelNavigationPolicy
} from './plugin-panel-webview-policy'

// The app has one theme and one language today; the panel follows it from here.
const APP_PANEL_COLOR_SCHEME: PanelColorScheme = 'dark'
const APP_PANEL_UI_LANGUAGE = 'en'

function createNonce(): string {
  return Array.from(ExpoCrypto.getRandomBytes(16), (byte) =>
    byte.toString(16).padStart(2, '0')
  ).join('')
}

type Props = {
  /** The shell document the host served; this component fills and wraps it. */
  shellHtml: string
  session: PluginPanelSession
  /** False while backgrounded: the watchdog pauses with the app. */
  active: boolean
  onUnresponsive: () => void
  onCloseRequested: () => void
}

export function PluginPanelWebView({
  shellHtml,
  session,
  active,
  onUnresponsive,
  onCloseRequested
}: Props) {
  const webViewRef = useRef<WebView>(null)
  const [loaded, setLoaded] = useState(false)
  const callbacks = useRef({ onUnresponsive, onCloseRequested })
  useEffect(() => {
    callbacks.current = { onUnresponsive, onCloseRequested }
  })

  // One nonce, policy and relay per document load; a new document is a new load.
  const load = useMemo(() => {
    const nonce = createNonce()
    let current = true
    const deliver = (message: unknown) =>
      webViewRef.current?.injectJavaScript(buildPanelDeliverScript(message))
    const watchdog = createPanelWatchdog({
      sendPing: (pingId) => deliver({ type: PANEL_PING_TYPE, pingId }),
      onUnresponsive: () => callbacks.current.onUnresponsive()
    })
    const relay = createPluginPanelHostRelay({
      nonce,
      getSessionToken: () => session.getSessionToken(),
      callPanelAction: (call) => session.callPanelAction(call),
      deliver,
      isCurrent: () => current,
      onPong: (pingId) => watchdog.handlePong(pingId),
      closePanel: () => callbacks.current.onCloseRequested()
    })
    const html = buildPluginPanelOuterDocument({
      panelDocument: fillPluginPanelShell(shellHtml, {
        colorScheme: APP_PANEL_COLOR_SCHEME,
        uiLanguage: APP_PANEL_UI_LANGUAGE,
        tokenCss: buildPanelDesignTokenCssFromValues(
          PANEL_DESIGN_TOKEN_VALUES[APP_PANEL_COLOR_SCHEME]
        )
      }),
      nonce,
      colorScheme: APP_PANEL_COLOR_SCHEME,
      background: PANEL_DESIGN_TOKEN_VALUES[APP_PANEL_COLOR_SCHEME]['--background']
    })
    return {
      html,
      relay,
      watchdog,
      allowNavigation: createPanelNavigationPolicy(),
      retire: () => {
        current = false
        watchdog.stop()
      }
    }
  }, [session, shellHtml])

  useEffect(() => () => load.retire(), [load])

  useEffect(() => {
    if (!loaded || !active) {
      return
    }
    // Started after load: the prelude must install its pong listener first.
    load.watchdog.start()
    return () => load.watchdog.stop()
  }, [active, load, loaded])

  return (
    <WebView
      ref={webViewRef}
      {...PLUGIN_PANEL_WEBVIEW_PROPS}
      {...(Platform.OS === 'ios' ? PLUGIN_PANEL_IOS_WEBVIEW_PROPS : {})}
      style={styles.webview}
      source={{ html: load.html }}
      onShouldStartLoadWithRequest={load.allowNavigation}
      onOpenWindow={() => {}}
      onLoadStart={() => setLoaded(false)}
      onLoadEnd={() => setLoaded(true)}
      onMessage={(event: WebViewMessageEvent) =>
        load.relay.handleWebViewMessage(event.nativeEvent.data)
      }
    />
  )
}

const styles = StyleSheet.create({
  webview: {
    flex: 1,
    backgroundColor: PANEL_DESIGN_TOKEN_VALUES[APP_PANEL_COLOR_SCHEME]['--background']
  }
})
