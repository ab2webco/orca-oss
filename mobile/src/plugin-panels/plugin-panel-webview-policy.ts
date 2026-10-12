/**
 * WebView configuration for a plugin panel: the native half of the desktop
 * sandbox. JavaScript runs only for the outer relay and the sandboxed frame;
 * everything that could reach files, storage, cookies, other windows or media
 * is off.
 */
export const PLUGIN_PANEL_WEBVIEW_PROPS = {
  // Why '*': a URL outside the whitelist is handed to Linking.openURL by the
  // library; the navigation policy below refuses it instead of opening it.
  originWhitelist: ['*'],
  javaScriptEnabled: true,
  allowFileAccess: false,
  allowFileAccessFromFileURLs: false,
  allowUniversalAccessFromFileURLs: false,
  allowingReadAccessToURL: undefined,
  javaScriptCanOpenWindowsAutomatically: false,
  // Why true: false makes Android load a target=_blank document into this
  // WebView, replacing the outer page. Popups are refused by onOpenWindow.
  setSupportMultipleWindows: true,
  domStorageEnabled: false,
  incognito: true,
  cacheEnabled: false,
  thirdPartyCookiesEnabled: false,
  sharedCookiesEnabled: false,
  geolocationEnabled: false,
  mixedContentMode: 'never',
  allowsLinkPreview: false,
  dataDetectorTypes: 'none',
  allowsBackForwardNavigationGestures: false,
  mediaPlaybackRequiresUserAction: true,
  allowsInlineMediaPlayback: false,
  allowsAirPlayForMediaPlayback: false,
  allowsPictureInPictureMediaPlayback: false,
  allowsProtectedMedia: false,
  paymentRequestEnabled: false,
  webviewDebuggingEnabled: false
} as const

export type PanelNavigationRequest = { url: string; isTopFrame?: boolean }

/** Panels are documents, never browsing contexts: the outer page and the
 *  panel srcdoc load once each and every later navigation is refused. One
 *  policy per WebView load. Android raises this only for the top frame; there
 *  the shell prelude's navigation guard is what holds the frame in place. */
export function createPanelNavigationPolicy(): (request: PanelNavigationRequest) => boolean {
  let outerLoaded = false
  let panelLoaded = false
  return (request) => {
    if (request.isTopFrame !== false) {
      if (!outerLoaded && request.url === 'about:blank') {
        outerLoaded = true
        return true
      }
      return false
    }
    if (!panelLoaded && request.url === 'about:srcdoc') {
      panelLoaded = true
      return true
    }
    return false
  }
}
