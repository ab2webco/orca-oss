import React, { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { isPluginPanelTabKey } from '../../../../shared/plugins/plugin-manifest'
import {
  PANEL_CONTENT_HEIGHT_INITIAL_PX,
  PANEL_PING_TYPE,
  PLUGIN_PANEL_FRAME_NAME_PREFIX,
  readPanelContentHeight
} from '../../../../shared/plugins/plugin-panel-bridge'
import {
  PANEL_SHELL_COLOR_SCHEME_PLACEHOLDER,
  PANEL_SHELL_UI_LANGUAGE_PLACEHOLDER,
  PANEL_SHELL_TOKENS_PLACEHOLDER
} from '../../../../shared/plugins/plugin-panel-shell'
import {
  callPanelActionViaPreload,
  createPanelBridgeMessageHandler
} from './plugin-panel-bridge-host'
import { createPanelWatchdog } from './plugin-panel-watchdog'
import { buildPanelDesignTokenCss, currentPanelColorScheme } from './plugin-panel-design-token-css'
import { usePluginPanelThemeRevision } from './use-plugin-panel-theme-revision'
import {
  usePluginPanelApproval,
  usePluginPanels,
  usePluginPanelsStore
} from '@/store/plugin-panels'
import { PluginPendingApprovalNotice } from '../plugins/PluginPendingApprovalNotice'
import { i18n, translate } from '@/i18n/i18n'
import { cn } from '@/lib/utils'

type PluginPanelProps = {
  tabKey: string
  /** Opt-in: size the frame to the height the panel reports from inside itself
   *  instead of filling the box. For a host that scrolls as one page; omitted,
   *  the frame keeps filling whatever height it is handed. */
  flowWithContentHeight?: boolean
}

type PluginPanelEntryState =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'unresponsive' }
  | { status: 'ready'; shellHtml: string; documentRevision: number }

function PluginPanelMessage({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <div className="flex min-h-0 flex-1 items-center justify-center p-6 text-center text-sm text-muted-foreground">
      {children}
    </div>
  )
}

/** Fills the shell placeholders main cannot know (theme class + token
 *  values). First-occurrence replace: the prelude parses before any plugin
 *  content, so a plugin echoing the placeholder string is inert. */
function fillPanelShell(html: string): string {
  return html
    .replace(PANEL_SHELL_COLOR_SCHEME_PLACEHOLDER, currentPanelColorScheme())
    .replace(PANEL_SHELL_UI_LANGUAGE_PLACEHOLDER, currentPanelUiLanguage())
    .replace(PANEL_SHELL_TOKENS_PLACEHOLDER, buildPanelDesignTokenCss())
}

/** The locale i18next resolved, sanitised to what a `lang` attribute may hold.
 *  A plugin that ships no translation for it falls back on its own; the point
 *  is that it no longer has to ask. */
function currentPanelUiLanguage(): string {
  const resolved = typeof i18n.language === 'string' ? i18n.language : ''
  return /^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$/.test(resolved) ? resolved : 'en'
}

function PluginPanel({ tabKey, flowWithContentHeight }: PluginPanelProps): React.JSX.Element {
  const panels = usePluginPanels()
  const setPanelHealth = usePluginPanelsStore((state) => state.setPanelHealth)
  const panel = isPluginPanelTabKey(tabKey)
    ? (panels.find((entry) => entry.tabKey === tabKey) ?? null)
    : null
  const [entryState, setEntryState] = useState<PluginPanelEntryState>({ status: 'loading' })
  const [sessionToken, setSessionToken] = useState<string | null>(null)
  const [loadedFrameKey, setLoadedFrameKey] = useState<string | null>(null)
  const [reportedHeight, setReportedHeight] = useState<{
    frameKey: string
    height: number
  } | null>(null)
  const iframeRef = useRef<HTMLIFrameElement | null>(null)
  const themeRevision = usePluginPanelThemeRevision()
  const { i18n: activeI18n } = useTranslation()
  const uiLanguage = activeI18n.language

  const pluginKey = panel?.pluginKey ?? null
  const panelId = panel?.id ?? null
  const approval = usePluginPanelApproval(pluginKey)
  const panelShell = entryState.status === 'ready' ? entryState.shellHtml : null
  const panelDocument = panelShell ? fillPanelShell(panelShell) : null
  // Why: the shell bakes Orca's color scheme + design tokens into srcdoc, so the
  // frame must be rebuilt when the app theme changes, not only when the document does.
  const panelFrameKey =
    entryState.status === 'ready'
      ? `${tabKey}:${entryState.documentRevision}:${themeRevision}:${uiLanguage}`
      : null
  const contentHeight =
    reportedHeight && reportedHeight.frameKey === panelFrameKey ? reportedHeight.height : null
  const watchdog = useMemo(
    () =>
      createPanelWatchdog({
        sendPing: (pingId) =>
          iframeRef.current?.contentWindow?.postMessage({ type: PANEL_PING_TYPE, pingId }, '*'),
        onUnresponsive: () => {
          setPanelHealth(tabKey, 'error')
          setEntryState({ status: 'unresponsive' })
        }
      }),
    [setPanelHealth, tabKey]
  )

  useEffect(() => {
    if (!sessionToken || !panelDocument) {
      return
    }
    let active = true
    const handler = createPanelBridgeMessageHandler({
      sessionToken,
      getPanelWindow: () => iframeRef.current?.contentWindow ?? null,
      callPanelAction: callPanelActionViaPreload,
      isActive: () => active,
      onPong: (pingId) => watchdog.handlePong(pingId)
    })
    window.addEventListener('message', handler)
    return () => {
      active = false
      window.removeEventListener('message', handler)
    }
  }, [panelDocument, sessionToken, watchdog])

  useEffect(() => {
    if (!flowWithContentHeight || !panelFrameKey) {
      return
    }
    const handler = (event: MessageEvent): void => {
      // Same trust model as the action bridge: the frame's origin is opaque, so
      // the sending window's identity is the only check worth making. The value
      // itself is untrusted — the reader drops NaN, Infinity and non-positive
      // numbers and clamps the rest, so no panel can demand an arbitrary frame.
      const panelWindow = iframeRef.current?.contentWindow
      if (!panelWindow || event.source !== panelWindow) {
        return
      }
      const height = readPanelContentHeight(event.data)
      if (height === null) {
        return
      }
      // Stamped with the frame it measured: a reload or theme rebuild replaces
      // the document, and the old document's height must not size the new one.
      setReportedHeight({ frameKey: panelFrameKey, height })
    }
    window.addEventListener('message', handler)
    return () => window.removeEventListener('message', handler)
  }, [flowWithContentHeight, panelFrameKey])

  useEffect(() => {
    if (!panelFrameKey || loadedFrameKey !== panelFrameKey) {
      return
    }
    // The srcdoc prelude must install its pong listener before the first ping;
    // otherwise a healthy panel can lose the startup ping and be suspended.
    watchdog.start()
    return () => watchdog.stop()
  }, [loadedFrameKey, panelFrameKey, watchdog])

  useEffect(() => {
    // Un plugin pendiente no tiene entrada que servir: pedirla solo produce el
    // estado de error que hace pasar la espera de aprobacion por una falla.
    if (!pluginKey || !panelId || approval !== 'approved') {
      return
    }
    let cancelled = false
    let currentHtml: string | null = null
    let documentRevision = 0
    setEntryState({ status: 'loading' })
    setSessionToken(null)
    const pluginsApi = window.api?.plugins
    if (!pluginsApi) {
      setPanelHealth(tabKey, 'error')
      setEntryState({ status: 'error' })
      return
    }
    let loadGeneration = 0
    const load = (): void => {
      const generation = ++loadGeneration
      pluginsApi
        .readPanelEntry({ pluginKey, panelId })
        .then((entry) => {
          if (cancelled || generation !== loadGeneration) {
            return
          }
          if (!entry) {
            currentHtml = null
            setSessionToken(null)
            setPanelHealth(tabKey, 'error')
            setEntryState({ status: 'error' })
            return
          }
          // Session rotation rebinds authority without replacing an unchanged
          // document or restarting its watchdog.
          setSessionToken(entry.sessionToken)
          setPanelHealth(tabKey, 'healthy')
          if (entry.html !== currentHtml) {
            currentHtml = entry.html
            documentRevision += 1
            setPanelHealth(tabKey, 'healthy')
            setEntryState({
              status: 'ready',
              shellHtml: entry.html,
              documentRevision
            })
          }
        })
        .catch(() => {
          if (!cancelled && generation === loadGeneration) {
            currentHtml = null
            setSessionToken(null)
            setPanelHealth(tabKey, 'error')
            setEntryState({ status: 'error' })
          }
        })
    }
    load()
    const unsubscribe = pluginsApi.onChanged ? pluginsApi.onChanged(load) : null
    return () => {
      cancelled = true
      loadGeneration += 1
      unsubscribe?.()
    }
  }, [approval, panelId, pluginKey, setPanelHealth, tabKey])

  // Persisted plugin tabs can outlive their plugin (uninstalled/disabled);
  // render a graceful empty state instead of a broken frame.
  if (!panel) {
    return (
      <PluginPanelMessage>
        {translate(
          'auto.components.right.sidebar.PluginPanel.unavailable',
          'This plugin panel is no longer available.'
        )}
      </PluginPanelMessage>
    )
  }

  if (approval !== 'approved') {
    return <PluginPendingApprovalNotice pluginName={panel.pluginName} approval={approval} />
  }

  if (entryState.status === 'loading') {
    return (
      <PluginPanelMessage>
        {translate('auto.components.right.sidebar.PluginPanel.loading', 'Loading plugin panel...')}
      </PluginPanelMessage>
    )
  }

  if (entryState.status === 'unresponsive') {
    return (
      <PluginPanelMessage>
        {translate(
          'auto.components.right.sidebar.PluginPanel.unresponsive',
          'This plugin panel stopped responding and was suspended.'
        )}
      </PluginPanelMessage>
    )
  }

  if (entryState.status === 'error') {
    return (
      <PluginPanelMessage>
        {translate(
          'auto.components.right.sidebar.PluginPanel.loadFailed',
          'The plugin panel could not be loaded.'
        )}
      </PluginPanelMessage>
    )
  }

  return (
    <iframe
      key={panelFrameKey}
      ref={iframeRef}
      // SECURITY: never add allow-same-origin — the srcdoc frame must stay an
      // opaque origin so plugin UI cannot reach the app DOM, storage, or IPC.
      // The srcdoc itself is the host CSP shell wrapped around plugin HTML.
      sandbox="allow-scripts"
      name={`${PLUGIN_PANEL_FRAME_NAME_PREFIX}${tabKey}`}
      srcDoc={panelDocument ?? ''}
      onLoad={() => setLoadedFrameKey(panelFrameKey)}
      title={panel.title}
      className={cn(
        'w-full border-0 bg-background',
        flowWithContentHeight ? 'shrink-0' : 'h-full flex-1'
      )}
      style={
        flowWithContentHeight
          ? { height: contentHeight ?? PANEL_CONTENT_HEIGHT_INITIAL_PX }
          : undefined
      }
    />
  )
}

export default PluginPanel
